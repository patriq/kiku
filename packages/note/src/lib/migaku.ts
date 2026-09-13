import { getMoraCount } from "./hatsuon";
import type { AnkiFields, AnkiNote } from "./types";
import { ankiFieldsSkeleton } from "./types";

export type MigakuSyntaxPart =
  | { type: "raw" | "plain"; text: string }
  | {
      type: "syntax";
      wordPre: string;
      wordPost: string;
      reading: string;
      dictForm: string;
      pitchAccents: string[];
    };

type FuriganaSegment = { text: string; reading: string };

//// MIGAKU JAPANESE SUPPORT START ////

//// YOMICHAN START ////

const KATAKANA_SMALL_KA_CODE_POINT = 0x30f5;
const KATAKANA_SMALL_KE_CODE_POINT = 0x30f6;
const KANA_PROLONGED_SOUND_MARK_CODE_POINT = 0x30fc;

const HIRAGANA_RANGE = [0x3040, 0x309f] as const;
const KATAKANA_RANGE = [0x30a0, 0x30ff] as const;

const HIRAGANA_CONVERSION_RANGE = [0x3041, 0x3096] as const;
const KATAKANA_CONVERSION_RANGE = [0x30a1, 0x30f6] as const;

const KANA_RANGES = [HIRAGANA_RANGE, KATAKANA_RANGE] as const;

const VOWEL_TO_KANA_MAPPING = new Map([
  ["a", "ぁあかがさざただなはばぱまゃやらゎわヵァアカガサザタダナハバパマャヤラヮワヵヷ"],
  ["i", "ぃいきぎしじちぢにひびぴみりゐィイキギシジチヂニヒビピミリヰヸ"],
  ["u", "ぅうくぐすずっつづぬふぶぷむゅゆるゥウクグスズッツヅヌフブプムュユルヴ"],
  ["e", "ぇえけげせぜてでねへべぺめれゑヶェエケゲセゼテデネヘベペメレヱヶヹ"],
  ["o", "ぉおこごそぞとどのほぼぽもょよろをォオコゴソゾトドノホボポモョヨロヲヺ"],
  ["", "のノ"],
] as const);

const KANA_TO_VOWEL_MAPPING = (() => {
  const map = new Map<string, string>();
  for (const [vowel, characters] of VOWEL_TO_KANA_MAPPING) {
    for (const character of characters) {
      map.set(character, vowel);
    }
  }
  return map;
})();

function getProlongedHiragana(previousCharacter: string) {
  switch (KANA_TO_VOWEL_MAPPING.get(previousCharacter)) {
    case "a":
      return "あ";
    case "i":
      return "い";
    case "u":
      return "う";
    case "e":
      return "え";
    case "o":
      return "う";
    default:
      return null;
  }
}

function isCodePointInRange(codePoint: number, [min, max]: readonly [number, number]) {
  return codePoint >= min && codePoint <= max;
}

function isCodePointInRanges(codePoint: number, ranges: readonly (readonly [number, number])[]) {
  for (const [min, max] of ranges) {
    if (codePoint >= min && codePoint <= max) {
      return true;
    }
  }
  return false;
}

function isCodePointKana(codePoint: number) {
  return isCodePointInRanges(codePoint, KANA_RANGES);
}

export function convertKatakanaToHiragana(text: string, keepProlongedSoundMarks = false) {
  let result = "";
  const offset = HIRAGANA_CONVERSION_RANGE[0] - KATAKANA_CONVERSION_RANGE[0];
  for (let char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    switch (codePoint) {
      case KATAKANA_SMALL_KA_CODE_POINT:
      case KATAKANA_SMALL_KE_CODE_POINT:
        // No change
        break;
      case KANA_PROLONGED_SOUND_MARK_CODE_POINT:
        if (!keepProlongedSoundMarks && result.length > 0) {
          const char2 = getProlongedHiragana(result[result.length - 1]);
          if (char2 !== null) {
            char = char2;
          }
        }
        break;
      default:
        if (isCodePointInRange(codePoint, KATAKANA_CONVERSION_RANGE)) {
          char = String.fromCodePoint(codePoint + offset);
        }
        break;
    }
    result += char;
  }
  return result;
}

function createFuriganaSegment(text: string, reading: string): FuriganaSegment {
  return { text, reading };
}

type FuriganaGroup = { isKana: boolean; text: string; textNormalized: string | null };

function getFuriganaKanaSegments(text: string, reading: string) {
  const textLength = text.length;
  const newSegments: FuriganaSegment[] = [];
  let start = 0;
  let state = reading[0] === text[0];
  for (let i = 1; i < textLength; ++i) {
    const newState = reading[i] === text[i];
    if (state === newState) {
      continue;
    }
    newSegments.push(
      createFuriganaSegment(text.substring(start, i), state ? "" : reading.substring(start, i)),
    );
    state = newState;
    start = i;
  }
  newSegments.push(
    createFuriganaSegment(
      text.substring(start, textLength),
      state ? "" : reading.substring(start, textLength),
    ),
  );
  return newSegments;
}

function segmentizeFurigana(
  reading: string,
  readingNormalized: string,
  groups: FuriganaGroup[],
  groupsStart: number,
): FuriganaSegment[] | null {
  const groupCount = groups.length - groupsStart;
  if (groupCount <= 0) {
    return reading.length === 0 ? [] : null;
  }

  const group = groups[groupsStart];
  if (group.isKana) {
    const textLength = group.text.length;
    const textNormalized = group.textNormalized ?? "";
    if (readingNormalized.startsWith(textNormalized)) {
      const segments = segmentizeFurigana(
        reading.substring(textLength),
        readingNormalized.substring(textLength),
        groups,
        groupsStart + 1,
      );
      if (segments !== null) {
        if (reading.startsWith(group.text)) {
          segments.unshift(createFuriganaSegment(group.text, ""));
        } else {
          segments.unshift(...getFuriganaKanaSegments(group.text, reading));
        }
        return segments;
      }
    }
    return null;
  } else {
    let result: FuriganaSegment[] | null = null;
    for (let i = reading.length; i >= group.text.length; --i) {
      const segments = segmentizeFurigana(
        reading.substring(i),
        readingNormalized.substring(i),
        groups,
        groupsStart + 1,
      );
      if (segments !== null) {
        if (result !== null) {
          // More than one way to segmentize the tail; mark as ambiguous
          return null;
        }
        const segmentReading = reading.substring(0, i);
        segments.unshift(createFuriganaSegment(group.text, segmentReading));
        result = segments;
      }
      // There is only one way to segmentize the last non-kana group
      if (groupCount === 1) {
        break;
      }
    }
    return result;
  }
}

function distributeFurigana(term: string, reading: string) {
  if (reading === term) {
    // Same
    return [createFuriganaSegment(term, "")];
  }

  const groups: FuriganaGroup[] = [];
  let groupPre: FuriganaGroup | null = null;
  let isKanaPre: boolean | null = null;
  for (const c of term) {
    const codePoint = c.codePointAt(0) ?? 0;
    const isKana = isCodePointKana(codePoint);
    if (isKana === isKanaPre && groupPre !== null) {
      groupPre.text += c;
    } else {
      groupPre = { isKana, text: c, textNormalized: null };
      groups.push(groupPre);
      isKanaPre = isKana;
    }
  }
  for (const group of groups) {
    if (group.isKana) {
      group.textNormalized = convertKatakanaToHiragana(group.text);
    }
  }

  const readingNormalized = convertKatakanaToHiragana(reading);
  const segments = segmentizeFurigana(reading, readingNormalized, groups, 0);
  if (segments !== null) {
    return segments;
  }

  // Fallback
  return [createFuriganaSegment(term, reading)];
}

//// YOMICHAN END ////

/** Parse the syntax emitted by Migaku's Japanese language support. */
export function parseMigakuSyntax(text: string): MigakuSyntaxPart[] {
  const ret: MigakuSyntaxPart[] = [];

  // without workarounds for missing spaces: /{([^]*?)}|((\S*)\[(.*?)\](\S*))|([^ {]+)/gm
  // oxlint-disable-next-line no-useless-escape
  const syntax_re = /{([^]*?)}|(([^\[\]\s\{\}　]*)\[(.*?)\]([^\[\]\s\{\}　]*))|([^ \u00A0{　]+)/gm;

  const ja_text_re = new RegExp(
    // oxlint-disable-next-line no-useless-escape
    /[\u3041-\u3096\u30A0-\u30FF\u3400-\u4DB5\u4E00-\u9FCB\uF900-\uFA6A\u2E80-\u2FD5\uFF65-\uFF9F\々]/m,
  );

  let match: RegExpExecArray | null;
  do {
    match = syntax_re.exec(text);
    if (!match) break;
    if (match[1]) ret.push({ type: "raw", text: match[1] });
    else if (match[2]) {
      const bracketParts = match[4].split(";");
      const firstParts = bracketParts[0].split(",");
      const prefix = match[3];
      let split = prefix.length;
      while (split > 0 && ja_text_re.test(prefix[split - 1])) split--;
      if (split > 0) ret.push({ type: "plain", text: prefix.slice(0, split) });
      ret.push({
        type: "syntax",
        wordPre: prefix.slice(split),
        wordPost: match[5],
        reading: firstParts[0] || "",
        dictForm: firstParts[1] || "",
        pitchAccents: (bracketParts[1] || "").split(","),
      });
    } else if (match[6]) ret.push({ type: "plain", text: match[6] });
  } while (match);
  return ret;
}

//// MIGAKU JAPANESE SUPPORT END ////

//// KIKU FIELD ADAPTER START ////

/**
 * Migaku deliberately falls back to one ruby when a mixed kana/kanji term has
 * more than one valid distribution. Kiku's bracket parser cannot represent
 * that fallback faithfully, so select Migaku's first (longest) valid split.
 * Normalization-equivalent kana also remain unannotated in Kiku.
 */
function segmentizeKikuFurigana(
  reading: string,
  readingNormalized: string,
  groups: FuriganaGroup[],
  groupsStart: number,
): FuriganaSegment[] | null {
  const groupCount = groups.length - groupsStart;
  if (groupCount <= 0) {
    return reading.length === 0 ? [] : null;
  }

  const group = groups[groupsStart];
  if (group.isKana) {
    const textLength = group.text.length;
    const textNormalized = group.textNormalized ?? "";
    if (!readingNormalized.startsWith(textNormalized)) {
      return null;
    }
    const segments = segmentizeKikuFurigana(
      reading.substring(textLength),
      readingNormalized.substring(textLength),
      groups,
      groupsStart + 1,
    );
    if (segments !== null) {
      segments.unshift(createFuriganaSegment(group.text, ""));
    }
    return segments;
  }

  for (let i = reading.length; i >= group.text.length; --i) {
    const segments = segmentizeKikuFurigana(
      reading.substring(i),
      readingNormalized.substring(i),
      groups,
      groupsStart + 1,
    );
    if (segments !== null) {
      segments.unshift(createFuriganaSegment(group.text, reading.substring(0, i)));
      return segments;
    }
    if (groupCount === 1) {
      break;
    }
  }
  return null;
}

function distributeKikuFurigana(term: string, reading: string) {
  if (reading === term) {
    return [createFuriganaSegment(term, "")];
  }

  const groups: FuriganaGroup[] = [];
  let groupPre: FuriganaGroup | null = null;
  let isKanaPre: boolean | null = null;
  for (const c of term) {
    const isKana = isCodePointKana(c.codePointAt(0) ?? 0);
    if (isKana === isKanaPre && groupPre !== null) {
      groupPre.text += c;
    } else {
      groupPre = { isKana, text: c, textNormalized: null };
      groups.push(groupPre);
      isKanaPre = isKana;
    }
  }
  for (const group of groups) {
    if (group.isKana) {
      group.textNormalized = convertKatakanaToHiragana(group.text);
    }
  }

  const segments = segmentizeKikuFurigana(reading, convertKatakanaToHiragana(reading), groups, 0);
  return segments ?? distributeFurigana(term, reading);
}

/**
 * Kiku stores fields as HTML strings and also runs this conversion in a web
 * worker, where Migaku's DOM traversal is unavailable. Preserve tags as
 * opaque nodes so transformTextNodes can follow Migaku's text-node algorithm.
 */
function splitFieldHtml(text: string) {
  return text.split(/(<[^>]*>)/g);
}

function transformTextNodes(text: string, render: (part: MigakuSyntaxPart) => string) {
  const parts = splitFieldHtml(text);
  const fieldText = parts.filter((part) => !part.startsWith("<")).join("");

  // Ignore field if it doesn't contain syntax
  const syntaxTestPattern = /[{}[\]]/u;
  if (!syntaxTestPattern.test(fieldText)) {
    return text;
  }

  let inCurly = false;
  return parts
    .map((part) => {
      if (part.startsWith("<")) {
        return part;
      }

      let textNode = part;

      // Handle curly braces spanning across tags (ugly, ugly, ugly)
      if (inCurly) {
        textNode = `{${textNode}`;
      }
      for (let i = textNode.length - 1; i >= 0; i--) {
        if (textNode[i] === "}") {
          inCurly = false;
          break;
        } else if (textNode[i] === "{") {
          inCurly = true;
          break;
        }
      }
      if (inCurly) {
        textNode += "}";
      }

      return parseMigakuSyntax(textNode).map(render).join("");
    })
    .join("");
}

function renderSurfacePart(part: MigakuSyntaxPart) {
  return part.type === "syntax" ? `${part.wordPre}${part.wordPost}` : part.text;
}

function renderBracketPart(part: MigakuSyntaxPart) {
  if (part.type !== "syntax") return part.text;
  return `${distributeKikuFurigana(part.wordPre, part.reading)
    .map(({ text, reading }) => `${text}${reading ? `[${reading}]` : ""}`)
    .join("")}${part.wordPost}`;
}

function renderRubyPart(part: MigakuSyntaxPart) {
  if (part.type !== "syntax") return part.text;
  const segments = distributeKikuFurigana(part.wordPre, part.reading);
  if (segments.length === 1 && !segments[0].reading) return `${part.wordPre}${part.wordPost}`;
  return `<ruby>${segments.map(({ text, reading }) => `${text}<rt>${reading}</rt>`).join("")}${part.wordPost}</ruby>`;
}

function renderKanaPart(part: MigakuSyntaxPart) {
  return part.type === "syntax" ? `${part.reading || part.wordPre}${part.wordPost}` : part.text;
}

function normalizeHighlightTags(text: string) {
  return text.replace(/<\s*(\/?)\s*(?:t|strong)\b[^>]*>/giu, (_, closing: string) =>
    closing ? "</b>" : "<b>",
  );
}

/** Remove Migaku annotations, retaining the Japanese surface text. */
export function removeMigakuSyntax(text: string) {
  return normalizeHighlightTags(transformTextNodes(text, renderSurfacePart));
}

/** Convert Migaku notation into the bracket notation consumed by Kiku. */
export function convertMigakuFurigana(text: string) {
  return normalizeHighlightTags(transformTextNodes(text, renderBracketPart));
}

/** Render Migaku notation as the value Anki's `furigana:` helper would provide. */
export function renderMigakuFurigana(text: string) {
  return normalizeHighlightTags(transformTextNodes(text, renderRubyPart));
}

/** Render Migaku notation as the value Anki's `kana:` helper would provide. */
export function renderMigakuKana(text: string) {
  return normalizeHighlightTags(transformTextNodes(text, renderKanaPart));
}

function syntaxParts(text: string) {
  return splitFieldHtml(text)
    .filter((part) => !part.startsWith("<"))
    .flatMap(parseMigakuSyntax)
    .filter(
      (part): part is Extract<MigakuSyntaxPart, { type: "syntax" }> => part.type === "syntax",
    );
}

function pitchPosition(pitch: string, reading: string) {
  if (pitch[0] === "h") return 0;
  if (pitch[0] === "a") return 1;
  if (pitch[0] === "o") return getMoraCount(reading);
  if (pitch[0] === "n" || pitch[0] === "k") {
    const position = Number.parseInt(pitch.slice(1), 10);
    return Number.isNaN(position) ? undefined : position;
  }
  return undefined;
}

function pitchType(pitch: string) {
  if (pitch[0] === "h") return "heiban";
  if (pitch[0] === "a") return "atamadaka";
  if (pitch[0] === "o") return "odaka";
  if (pitch[0] === "k") return "kifuku";
  if (pitch[0] === "n") return "nakadaka";
  return undefined;
}

function hasMigakuSyntax(text: string) {
  return (
    syntaxParts(text).some((part) => part.dictForm || part.pitchAccents.some(Boolean)) ||
    /\{[\s\S]*?\}/u.test(text)
  );
}

function containsMigakuSyntax(fields: AnkiFields) {
  return [
    fields.Expression,
    fields.ExpressionFurigana,
    fields.Sentence,
    fields.SentenceFurigana,
    fields.MainDefinition,
    fields.Glossary,
    fields.MiscInfo,
  ].some(hasMigakuSyntax);
}

/**
 * Transform the contents of already-mapped Kiku fields and synthesize the
 * helper fields normally supplied by Anki's Japanese support filters.
 */
export function normalizeAnkiFields(fields: AnkiFields): AnkiFields {
  if (!containsMigakuSyntax(fields)) return fields;

  const expressionSource = fields.ExpressionFurigana || fields.Expression;
  const sentenceSource = fields.SentenceFurigana || fields.Sentence;
  const expressionReading = convertKatakanaToHiragana(
    removeMigakuSyntax(fields.ExpressionReading) || renderMigakuKana(expressionSource),
  );
  const pitches = syntaxParts(expressionSource)
    .flatMap((part) =>
      part.pitchAccents.map((pitch) => ({
        pitch,
        reading: convertKatakanaToHiragana(`${part.reading || part.wordPre}${part.wordPost}`),
      })),
    )
    .map(({ pitch, reading }) => ({
      position: pitchPosition(pitch, reading),
      type: pitchType(pitch),
    }))
    .filter(
      (pitch): pitch is { position: number; type: string } =>
        pitch.position !== undefined && pitch.type !== undefined,
    );
  const expressionSurface = removeMigakuSyntax(expressionSource);
  const sentenceSurface =
    normalizeHighlightTags(fields.Sentence) || removeMigakuSyntax(sentenceSource);
  const sentenceRuby = renderMigakuFurigana(sentenceSource);

  return {
    ...fields,
    Expression: expressionSurface,
    ExpressionFurigana: convertMigakuFurigana(expressionSource),
    ExpressionReading: expressionReading,
    MainDefinition: renderMigakuFurigana(fields.MainDefinition),
    Sentence: sentenceSurface,
    SentenceFurigana: convertMigakuFurigana(sentenceSource),
    Glossary: renderMigakuFurigana(fields.Glossary),
    PitchPosition: pitches.map(({ position }) => position).join(","),
    PitchCategories: pitches.map(({ type }) => type).join(","),
    MiscInfo: renderMigakuFurigana(fields.MiscInfo),
    "furigana:ExpressionFurigana": renderMigakuFurigana(expressionSource),
    "kana:ExpressionFurigana": expressionReading,
    "furigana:Sentence": sentenceRuby,
    "kanji:Sentence": sentenceSurface,
    "furigana:SentenceFurigana": sentenceRuby,
    "kana:SentenceFurigana": renderMigakuKana(sentenceSource),
  };
}

type NoteField = { order: number; value: string };
type ConvertibleAnkiNote = Omit<AnkiNote, "fields"> & { fields: Record<string, NoteField> };

const helperSourceFields: Partial<Record<keyof AnkiFields, keyof AnkiFields>> = {
  "furigana:ExpressionFurigana": "ExpressionFurigana",
  "kana:ExpressionFurigana": "ExpressionFurigana",
  "furigana:Sentence": "Sentence",
  "kanji:Sentence": "Sentence",
  "furigana:SentenceFurigana": "SentenceFurigana",
  "kana:SentenceFurigana": "SentenceFurigana",
};

/** Convert a cached Migaku note without mutating the cache's raw note object. */
export function normalizeAnkiNote(note: ConvertibleAnkiNote): AnkiNote {
  const values = Object.fromEntries(
    Object.entries(note.fields).map(([name, field]) => [name, field.value]),
  ) as Partial<AnkiFields>;
  const completeFields = { ...ankiFieldsSkeleton, ...values };
  if (!containsMigakuSyntax(completeFields)) return note as AnkiNote;
  const converted = normalizeAnkiFields(completeFields);
  const fields = Object.fromEntries(
    Object.entries(converted).map(([name, fieldValue]) => {
      const sourceName = helperSourceFields[name as keyof AnkiFields];
      const order =
        note.fields[name]?.order ?? (sourceName ? note.fields[sourceName]?.order : undefined) ?? 0;
      return [name, { order, value: String(fieldValue) }];
    }),
  ) as AnkiNote["fields"];
  return { ...note, fields };
}

export function normalizeAnkiNotes(notes: ConvertibleAnkiNote[]): AnkiNote[] {
  return notes.map(normalizeAnkiNote);
}

//// KIKU FIELD ADAPTER END ////
