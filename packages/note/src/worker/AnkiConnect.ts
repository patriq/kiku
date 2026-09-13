import { normalizeAnkiNotes } from "#/src/lib/migaku";
import { parseRelatedExpression } from "#/src/lib/parse-related-expression";
import type { AnkiNote } from "#/src/lib/types";
import type { MainThreadApi } from "./MainThreadApi";

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class AnkiConnect {
  private fetchJson: MainThreadApi["fetchJson"];
  public ankiConnectAddress: string;

  constructor(fetchJson: MainThreadApi["fetchJson"], ankiConnectAddress: string) {
    this.fetchJson = fetchJson;
    this.ankiConnectAddress = ankiConnectAddress;
  }

  async invoke(action: string, params: Record<string, unknown> = {}) {
    const result = (await this.fetchJson(this.ankiConnectAddress, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
    })) as { error?: string; result: unknown };
    if (result.error) throw new Error(result.error);
    return result.result;
  }

  async batchFindNotes(queries: string[]) {
    return (await this.invoke("multi", {
      actions: queries.map((query) => ({
        action: "findNotes",
        params: { query },
      })),
    })) as Array<number[]>;
  }

  async batchNotesInfo(noteIdsList: number[][]) {
    const noteBatches = (await this.invoke("multi", {
      actions: noteIdsList.map((ids) => ({
        action: "notesInfo",
        params: { notes: ids },
      })),
    })) as Array<AnkiNote[]>;
    return noteBatches.map(normalizeAnkiNotes);
  }

  async queryFieldContains({
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
    const noteFilter = `("note:Kiku" OR "note:Lapis")`;

    const kanjiPattern = kanjiList.map(escapeRegex).join("|");
    const kanjiQuery =
      kanjiList.length === 0 ? null : `${noteFilter} AND Expression:re:${kanjiPattern}`;

    const readingPattern = readingList.map(escapeRegex).join("|");
    const readingQuery =
      readingList.length === 0
        ? null
        : `${noteFilter} AND ExpressionReading:re:^${readingPattern}$`;

    const expressionPattern = expressionList.map(escapeRegex).join("|");
    const expressionQuery =
      expressionList.length === 0
        ? null
        : `${noteFilter} AND (Expression:re:^${expressionPattern}$ OR RelatedExpression:re:${expressionPattern})`;

    const newQuery = `${noteFilter} AND is:new`;

    const queries = [kanjiQuery, readingQuery, expressionQuery].filter(Boolean) as string[];
    if (withNewNotes) queries.push(newQuery);
    const idsLists = await this.batchFindNotes(queries);
    const allIds = [...new Set(idsLists.flat())];
    const [allNotes] = await this.batchNotesInfo([allIds]);
    const newNoteIds = withNewNotes ? (idsLists[idsLists.length - 1] ?? []) : [];
    const newNoteIdsSet = new Set(newNoteIds);
    const newNotes: AnkiNote[] = withNewNotes
      ? allNotes.filter((n) => newNoteIdsSet.has(n.noteId))
      : [];

    const kanjiListResult: Record<string, AnkiNote[]> = {};
    const readingListResult: Record<string, AnkiNote[]> = {};
    const expressionListResult: Record<string, AnkiNote[]> = {};

    for (const k of kanjiList) {
      kanjiListResult[k] = allNotes.filter((n) => n.fields.Expression?.value.includes(k));
    }

    for (const r of readingList) {
      readingListResult[r] = allNotes.filter((n) => n.fields.ExpressionReading?.value === r);
    }

    for (const e of expressionList) {
      expressionListResult[e] = allNotes.filter((n) => {
        if (n.fields.Expression?.value === e) return true;
        const related = n.fields.RelatedExpression?.value;
        if (related) {
          const list = parseRelatedExpression(related);
          return list.includes(e);
        }
        return false;
      });
    }

    return { kanjiListResult, readingListResult, expressionListResult, newNotes };
  }
}
