import "#/src/lib/polyfill";
import type { KikuConfig } from "#/src/lib/config";
import type { Constants } from "#/src/lib/contants";
import { parseRelatedExpression } from "#/src/lib/parse-related-expression";
import { normalizeAnkiNotes } from "#/src/lib/migaku";
import type {
  AnkiFields,
  AnkiNote,
  KanjiInfo,
  KanjiInfoCompact,
  KikuDbMainManifest,
  KikuNotesManifest,
  TermInfo,
  TermInfoCompact,
} from "#/src/lib/types";

import { AnkiConnect } from "./AnkiConnect";
import { type NexRemote } from "./nex";
import type { MainThreadApi } from "./MainThreadApi";

export class WorkerThreadApi {
  main!: NexRemote<MainThreadApi>;
  assetsPath!: string;
  constants!: Constants;
  config!: KikuConfig;
  preferAnkiConnect!: boolean;
  cache = new Map();
  ankiConnect!: AnkiConnect;
  private readonly log = {
    trace: (...args: unknown[]) => this.main.log("trace", args),
    debug: (...args: unknown[]) => this.main.log("debug", args),
    info: (...args: unknown[]) => this.main.log("info", args),
    warn: (...args: unknown[]) => this.main.log("warn", args),
    error: (...args: unknown[]) => this.main.log("error", args),
  };

  init(payload: {
    assetsPath: string;
    constants: Constants;
    config: KikuConfig;
    preferAnkiConnect: boolean;
  }): void {
    this.assetsPath = payload.assetsPath;
    this.constants = payload.constants;
    this.config = payload.config;
    this.preferAnkiConnect = payload.preferAnkiConnect;
    this.ankiConnect = new AnkiConnect(this.main.fetchJson, this.config.ankiConnectAddress);
  }

  chunkCache = new Map<string, AnkiNote[]>();
  async query({
    kanjiList,
    readingList,
    expressionList,
    withNewNotes = true,
  }: {
    kanjiList: string[];
    readingList: string[];
    expressionList: string[];
    withNewNotes?: boolean;
  }) {
    const queryWithNotesCache = async () => {
      const kanjiListResult: Record<string, AnkiNote[]> = {};
      const readingListResult: Record<string, AnkiNote[]> = {};
      const expressionListResult: Record<string, AnkiNote[]> = {};
      const newNotes: AnkiNote[] = [];

      const manifest = await this.notesManifest();

      const kanjiSet = new Set(kanjiList);
      const readingSet = new Set(readingList);
      const expressionSet = new Set(expressionList);

      await Promise.all(
        manifest.chunks.map(async (chunk) => {
          if (this.chunkCache.has(chunk.file)) return;
          const buf = await this.main.fetchArrayBuffer(`${this.assetsPath}/${chunk.file}`);
          const text = await gunzipArrayBuffer(buf).text();
          const notes = JSON.parse(text) as AnkiNote[];
          this.chunkCache.set(chunk.file, normalizeAnkiNotes(notes));
        }),
      );

      for (const chunk of manifest.chunks) {
        const notes = this.chunkCache.get(chunk.file);
        if (!notes) continue;

        for (const note of notes) {
          if (note.modelName !== "Kiku" && note.modelName !== "Lapis") continue;

          const expr = note.fields.Expression.value;
          const reading = note.fields.ExpressionReading?.value ?? "";
          const relatedExprValue = note.fields.RelatedExpression?.value ?? "";

          // ------- Kanji Search (contains) -------
          for (const kanji of kanjiSet) {
            if (expr.includes(kanji)) {
              kanjiListResult[kanji] ??= [];
              kanjiListResult[kanji].push(note);
            }
          }

          // ------- Reading Search (exact) -------
          if (readingSet.has(reading)) {
            readingListResult[reading] ??= [];
            readingListResult[reading].push(note);
          }

          // ------- Expression Search (exact) -------
          if (expressionSet.has(expr)) {
            expressionListResult[expr] ??= [];
            expressionListResult[expr].push(note);
          }

          // ------- Related Expression Search (contains) -------
          if (relatedExprValue) {
            const relatedExprs = parseRelatedExpression(relatedExprValue);
            for (const rel of relatedExprs) {
              if (expressionSet.has(rel)) {
                expressionListResult[rel] ??= [];
                if (!expressionListResult[rel].includes(note)) {
                  expressionListResult[rel].push(note);
                }
              }
            }
          }
        }
      }

      return { kanjiListResult, readingListResult, expressionListResult, newNotes };
    };

    let result: {
      kanjiListResult: Record<string, AnkiNote[]>;
      readingListResult: Record<string, AnkiNote[]>;
      expressionListResult: Record<string, AnkiNote[]>;
      newNotes: AnkiNote[];
    };
    let isNotesCache: boolean;

    if (this.preferAnkiConnect) {
      try {
        void this.log.info("Querying with AnkiConnect");
        result = await this.ankiConnect.queryFieldContains({
          kanjiList,
          readingList,
          expressionList,
          withNewNotes,
        });
        isNotesCache = false;
      } catch {
        void this.log.warn("Failed to query with AnkiConnect, falling back to notes cache");
        result = await queryWithNotesCache();
        isNotesCache = true;
      }
    } else {
      try {
        void this.log.info("Querying with notes cache");
        result = await queryWithNotesCache();
        isNotesCache = true;
      } catch {
        void this.log.warn("Failed to query with notes cache, falling back to AnkiConnect");
        result = await this.ankiConnect.queryFieldContains({
          kanjiList,
          readingList,
          expressionList,
          withNewNotes,
        });
        isNotesCache = false;
      }
    }

    const sort = (res: Record<string, AnkiNote[]>) => {
      for (const key in res) {
        res[key].sort((a, b) => b.noteId - a.noteId);
      }
    };

    sort(result.kanjiListResult);
    sort(result.readingListResult);
    sort(result.expressionListResult);

    return { ...result, isNotesCache };
  }
  debounceTimer: ReturnType<typeof setTimeout> | null = null;
  debounceMs = 200;
  async queryShared({
    kanjiList,
    readingList,
    expressionList,
    ankiFields,
    withNewNotes = true,
  }: {
    kanjiList: string[];
    readingList?: string[];
    expressionList?: string[];
    ankiFields: AnkiFields;
    withNewNotes?: boolean;
  }) {
    return new Promise<{
      kanjiResult: Record<string, AnkiNote[]>;
      readingResult: Record<string, AnkiNote[]>;
      expressionResult: Record<string, AnkiNote[]>;
      newNotes: AnkiNote[];
      isNotesCache: boolean;
    }>((resolve, reject) => {
      this.pendingQueryShared.push({
        kanjiList,
        readingList: readingList ?? [],
        expressionList: expressionList ?? [],
        ankiFields,
        withNewNotes,
        resolve,
      });
      if (this.debounceTimer) clearTimeout(this.debounceTimer);

      this.debounceTimer = setTimeout(() => {
        this.actualQueryShared().catch((e) => {
          reject(e);
        });
      }, this.debounceMs);
    });
  }

  pendingQueryShared: {
    kanjiList: string[];
    readingList: string[];
    expressionList: string[];
    ankiFields: AnkiFields;
    withNewNotes: boolean;
    resolve: (v: {
      kanjiResult: Record<string, AnkiNote[]>;
      readingResult: Record<string, AnkiNote[]>;
      expressionResult: Record<string, AnkiNote[]>;
      newNotes: AnkiNote[];
      isNotesCache: boolean;
    }) => void;
  }[] = [];

  async actualQueryShared() {
    const requests = this.pendingQueryShared;
    this.pendingQueryShared = [];

    const batchedKanjiList = [...new Set(requests.flatMap((r) => r.kanjiList))];
    const batchedReadingList = [...new Set(requests.flatMap((r) => r.readingList))];
    const batchedExpressionList = [...new Set(requests.flatMap((r) => r.expressionList))];
    const needsNewNotes = requests.some((r) => r.withNewNotes);

    const { kanjiListResult, readingListResult, expressionListResult, newNotes, isNotesCache } =
      await this.query({
        kanjiList: batchedKanjiList,
        readingList: batchedReadingList,
        expressionList: batchedExpressionList,
        withNewNotes: needsNewNotes,
      });

    for (const req of requests) {
      const { kanjiList, readingList, expressionList, ankiFields } = req;

      const filterSameNote = (note: AnkiNote) => {
        if (note.cards.includes(Number(ankiFields.CardID))) return false;
        return true;
      };
      const filterSameExpression = (note: AnkiNote) => {
        return note.fields.Expression.value !== ankiFields.Expression;
      };

      // --- kanji ---
      const kanjiResult: Record<string, AnkiNote[]> = {};
      for (const kanji of kanjiList) {
        kanjiResult[kanji] =
          kanjiListResult[kanji]?.filter(filterSameNote).filter(filterSameExpression) ?? [];
      }

      // --- reading ---
      const readingResult: Record<string, AnkiNote[]> = {};
      for (const reading of readingList) {
        readingResult[reading] =
          readingListResult[reading]?.filter(filterSameNote).filter(filterSameExpression) ?? [];
      }

      // --- expression ---
      const expressionResult: Record<string, AnkiNote[]> = {};
      for (const expression of expressionList) {
        expressionResult[expression] =
          expressionListResult[expression]?.filter(filterSameNote) ?? [];
      }

      req.resolve({
        kanjiResult,
        readingResult,
        expressionResult,
        newNotes,
        isNotesCache,
      });
    }
  }

  lookupKanjiPromise: PromiseWithResolvers<Record<string, KanjiInfo>> | undefined;
  async lookupKanji(kanji: string): Promise<KanjiInfo | undefined> {
    const key = this.lookupKanji.name;
    const cached = this.cache.get(key);
    let result: KanjiInfo | undefined;
    if (cached) {
      result = cached[kanji];
    } else if (this.lookupKanjiPromise) {
      result = (await this.lookupKanjiPromise.promise)[kanji];
    } else {
      this.lookupKanjiPromise = Promise.withResolvers();
      const manifest = await this.dbMainManifest();
      const file = manifest.files[this.constants.tar["kiku_db_kanji_compact.json.gz"]];
      const buf = await this.main.fetchArrayBuffer(
        `${this.assetsPath}/${this.constants.assets["_kiku_db_main.tar"]}`,
        { headers: { Range: `bytes=${file.start}-${file.end}` } },
        { range: { start: file.start, end: file.end, size: file.size } },
      );

      const text = await gunzipArrayBuffer(buf).text();
      const dbKanjiCompact = JSON.parse(text);
      const dbKanji: Record<string, KanjiInfo> = {};
      for (const kanji of Object.keys(dbKanjiCompact)) {
        const data = fromCompact(dbKanjiCompact[kanji]);
        if (data) dbKanji[kanji] = data;
      }
      this.cache.set(key, dbKanji);
      this.lookupKanjiPromise.resolve(dbKanji);
      result = dbKanji[kanji];
    }
    return result;
  }

  lookupTermPromise: PromiseWithResolvers<Record<string, TermInfo>> | undefined;
  async lookupTerm(term: string): Promise<TermInfo | undefined> {
    const key = this.lookupTerm.name;
    const cached = this.cache.get(key);
    let result: TermInfo | undefined;
    if (cached) {
      result = cached[term];
    } else if (this.lookupTermPromise) {
      result = (await this.lookupTermPromise.promise)[term];
    } else {
      this.lookupTermPromise = Promise.withResolvers();
      const manifest = await this.dbMainManifest();
      const file = manifest.files[this.constants.tar["kiku_db_terms_compact.json.gz"]];
      const buf = await this.main.fetchArrayBuffer(
        `${this.assetsPath}/${this.constants.assets["_kiku_db_main.tar"]}`,
        { headers: { Range: `bytes=${file.start}-${file.end}` } },
        { range: { start: file.start, end: file.end, size: file.size } },
      );

      const text = await gunzipArrayBuffer(buf).text();
      const dbTermsCompact = JSON.parse(text);
      const dbTerms: Record<string, TermInfo> = {};
      for (const term of Object.keys(dbTermsCompact)) {
        const data = fromCompactTerm(dbTermsCompact[term]);
        if (data) dbTerms[term] = data;
      }
      this.cache.set(key, dbTerms);
      this.lookupTermPromise.resolve(dbTerms);
      result = dbTerms[term];
    }
    return result;
  }

  async dbMainManifest(): Promise<KikuDbMainManifest> {
    const key = this.dbMainManifest.name;
    if (this.cache.has(key)) return this.cache.get(key);
    let manifest: KikuDbMainManifest;
    try {
      manifest = (await this.main.fetchJson(
        `${this.assetsPath}/${this.constants.assets["_kiku_db_main_manifest.json"]}`,
        { cache: "no-store" },
      )) as KikuDbMainManifest;
    } catch {
      void this.log.error("Failed to load db main manifest");
      throw new Error("Failed to load db main manifest");
    }
    this.cache.set(key, manifest);
    return manifest;
  }

  async notesManifest(): Promise<KikuNotesManifest> {
    const key = this.notesManifest.name;
    if (this.cache.has(key)) return this.cache.get(key);
    let manifest: KikuNotesManifest;
    try {
      manifest = (await this.main.fetchJson(
        `${this.assetsPath}/${this.constants.assets["_kiku_notes_manifest.json"]}`,
        { cache: "no-store" },
      )) as KikuNotesManifest;
    } catch {
      throw new Error("Failed to load manifest");
    }
    this.cache.set(key, manifest);
    return manifest;
  }
}

function gunzipArrayBuffer(buf: ArrayBuffer) {
  if (buf.byteLength === 0) {
    throw new Error("No body for empty buffer");
  }
  const res = new Response(buf);
  if (!res.body) {
    throw new Error("No body for buffer");
  }
  const ds = new DecompressionStream("gzip");
  const decompressed = res.body.pipeThrough(ds);
  return new Response(decompressed);
}

function fromCompact(c: KanjiInfoCompact | undefined): KanjiInfo | undefined {
  if (!c) return undefined;
  return {
    composedOf: c[0],
    usedIn: c[1],
    wkMeaning: c[2],
    meanings: c[3],
    keyword: c[4],
    readings: c[5],
    frequency: c[6],
    kind: c[7],
    visuallySimilar: c[8],
    related: c[9],
  };
}

function fromCompactTerm(c: TermInfoCompact | undefined): TermInfo | undefined {
  if (!c) return undefined;
  return {
    forms: c[0],
    antonym: c[1],
    referenced: c[2],
  };
}
