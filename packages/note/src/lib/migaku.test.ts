import { describe, expect, it } from "vitest";
import { ankiFieldsSkeleton } from "./types";
import {
  convertKatakanaToHiragana,
  convertMigakuFurigana,
  normalizeAnkiFields,
  normalizeAnkiNote,
  parseMigakuSyntax,
  removeMigakuSyntax,
  renderMigakuFurigana,
  renderMigakuKana,
} from "./migaku";

const migakuFields = {
  ...ankiFieldsSkeleton,
  Expression: "点滅",
  ExpressionFurigana: "点滅[てんめつ;h]",
  ExpressionAudio: "[sound:c84f544c2a3.mp3]",
  MainDefinition:
    "点滅 (てんめつ) ★★\n\n∙ switching on and off (of a light), flashing, blinking, flickering",
  Sentence: "あ、でももう<t>点滅</t>し始めた。走ってよかったよ、本当に。",
  SentenceFurigana:
    "あ{、}でも[;a] もう[;a,h]<t>点滅[てんめつ;h]</t>し[,する;h] 始[はじ,はじめる;h]めた{。}走[はし,はしる;k2]って よかっ[,よい;k1]た よ{、}本当[ほんとう;o,h]に{。}",
  SentenceTranslation: "Ah, but it has already started blinking. I'm really glad we ran.",
  SentenceAudio: "[sound:b842fc84f54.mp3]",
  Picture: '<img src="39cfb842fc8.webp">',
  CardID: "1785064007553",
};

describe("Migaku's Japanese syntax", () => {
  it("parses the same syntax parts used by the managed card", () => {
    expect(parseMigakuSyntax("食べ[たべ,食べる;a2]た")).toEqual([
      {
        type: "syntax",
        wordPre: "食べ",
        wordPost: "た",
        reading: "たべ",
        dictForm: "食べる",
        pitchAccents: ["a2"],
      },
    ]);
  });

  it("renders surface, bracket, ruby, and kana variants", () => {
    const value = "<t>大好[だいす,大好き;h]</t>き";
    expect(removeMigakuSyntax(value)).toBe("<b>大好</b>き");
    expect(convertMigakuFurigana(value)).toBe("<b>大好[だいす]</b>き");
    expect(renderMigakuFurigana(value)).toBe("<b><ruby>大好<rt>だいす</rt></ruby></b>き");
    expect(renderMigakuKana(value)).toBe("<b>だいす</b>き");
  });

  it("keeps Migaku's raw curly-brace content and missing-space workaround", () => {
    const value = "あ{、}でも[;a] もう[;a,h] 点滅[てんめつ;h]{。}";
    expect(removeMigakuSyntax(value)).toBe("あ、でももう点滅。");
    expect(convertMigakuFurigana(value)).toBe("あ、でももう点滅[てんめつ]。");
  });

  it("handles Migaku raw segments which span HTML tags", () => {
    const value = "<b>{keep </b><i>this}</i> 点滅[てんめつ;h]";
    expect(removeMigakuSyntax(value)).toBe("<b>keep </b><i>this</i>点滅");
    expect(convertMigakuFurigana(value)).toBe("<b>keep </b><i>this</i>点滅[てんめつ]");
  });

  it("resolves ambiguous distributions into Kiku-compatible readings", () => {
    expect(convertMigakuFurigana("裏切り者[うらぎりもの;h]")).toBe("裏切[うらぎ]り者[もの]");
    expect(convertMigakuFurigana("日記をつける[にっきをつける;h]")).toBe("日記[にっき]をつける");
    expect(convertMigakuFurigana("命の恩人[いのちのおんじん;a]")).toBe(
      "命[いのち]の恩人[おんじん]",
    );
  });

  it("does not add hiragana above normalization-equivalent katakana", () => {
    expect(convertMigakuFurigana("オイル交換[おいるこうかん;h]")).toBe("オイル交換[こうかん]");
    expect(renderMigakuFurigana("オイル交換[おいるこうかん;h]")).toBe(
      "<ruby>オイル<rt></rt>交換<rt>こうかん</rt></ruby>",
    );
  });

  it("normalizes katakana and prolonged sounds for Kiku readings", () => {
    expect(convertKatakanaToHiragana("スーパー")).toBe("すうぱあ");
  });
});

describe("Migaku content in mapped Kiku fields", () => {
  it("normalizes the mapped Migaku fixture used by Kiku's preview", () => {
    expect(normalizeAnkiFields(migakuFields)).toMatchObject({
      Expression: "点滅",
      ExpressionFurigana: "点滅[てんめつ]",
      ExpressionReading: "てんめつ",
      ExpressionAudio: "[sound:c84f544c2a3.mp3]",
      MainDefinition:
        "点滅 (てんめつ) ★★\n\n∙ switching on and off (of a light), flashing, blinking, flickering",
      Sentence: "あ、でももう<b>点滅</b>し始めた。走ってよかったよ、本当に。",
      SentenceFurigana:
        "あ、でももう<b>点滅[てんめつ]</b>し始[はじ]めた。走[はし]ってよかったよ、本当[ほんとう]に。",
      SentenceTranslation: "Ah, but it has already started blinking. I'm really glad we ran.",
      SentenceAudio: "[sound:b842fc84f54.mp3]",
      Picture: '<img src="39cfb842fc8.webp">',
      PitchPosition: "0",
      PitchCategories: "heiban",
      CardID: "1785064007553",
    });
  });

  it("normalizes a complete real sentence card", () => {
    const fields = {
      ...ankiFieldsSkeleton,
      Expression: "季節",
      ExpressionFurigana: "季節[きせつ;a,n2]",
      ExpressionAudio: "[sound:word.mp3]",
      MainDefinition: "<p>季節[きせつ]の定義</p>",
      DefinitionPicture: '<img src="definition.webp">',
      Sentence: "季節は変わり　風は冷たさを増している",
      SentenceFurigana:
        "<t>季節[きせつ;a,n2]</t>は 変[か,かわる;h]わり{　}風[かぜ;h] は 冷[つめ,つめたい;h]た さ を 増[ま,ます;h]して いる[;h]",
      SentenceAudio: "[sound:sentence.mp3]",
      SentenceTranslation: "The seasons change.",
      Picture: '<img src="context.webp">',
      Glossary: "<p>季節[きせつ]の例</p>",
      MiscInfo: "<p>季節[きせつ]のメモ</p>",
      IsSentenceCard: "x",
      CardID: "42",
    };

    expect(normalizeAnkiFields(fields)).toMatchObject({
      Expression: "季節",
      ExpressionFurigana: "季節[きせつ]",
      ExpressionReading: "きせつ",
      ExpressionAudio: "[sound:word.mp3]",
      MainDefinition: "<p><ruby>季節<rt>きせつ</rt>の定義</ruby></p>",
      DefinitionPicture: '<img src="definition.webp">',
      Sentence: "季節は変わり　風は冷たさを増している",
      SentenceFurigana: "<b>季節[きせつ]</b>は変[か]わり　風[かぜ]は冷[つめ]たさを増[ま]している",
      SentenceAudio: "[sound:sentence.mp3]",
      SentenceTranslation: "The seasons change.",
      Picture: '<img src="context.webp">',
      Glossary: "<p><ruby>季節<rt>きせつ</rt>の例</ruby></p>",
      MiscInfo: "<p><ruby>季節<rt>きせつ</rt>のメモ</ruby></p>",
      PitchPosition: "1,2",
      PitchCategories: "atamadaka,nakadaka",
      IsSentenceCard: "x",
      CardID: "42",
    });
  });

  it("generates all helper fields Kiku expects", () => {
    const result = normalizeAnkiFields({
      ...ankiFieldsSkeleton,
      Expression: "大好き",
      ExpressionFurigana: "大好[だいす,大好き;h]き",
      Sentence: "これは大好きです",
      SentenceFurigana: "これは 大好[だいす,大好き;h]きです",
    });

    expect(result).toMatchObject({
      "furigana:ExpressionFurigana": "<ruby>大好<rt>だいす</rt>き</ruby>",
      "kana:ExpressionFurigana": "だいすき",
      "kanji:Sentence": "これは大好きです",
      "furigana:Sentence": "これは<ruby>大好<rt>だいす</rt>きです</ruby>",
      "furigana:SentenceFurigana": "これは<ruby>大好<rt>だいす</rt>きです</ruby>",
      "kana:SentenceFurigana": "これはだいすきです",
    });
  });

  it("prefers an already-mapped explicit expression reading", () => {
    expect(
      normalizeAnkiFields({
        ...ankiFieldsSkeleton,
        Expression: "オイル交換",
        ExpressionFurigana: "オイル交換[おいるこうかん;h]",
        ExpressionReading: "オイルこうかん",
      }),
    ).toMatchObject({
      ExpressionFurigana: "オイル交換[こうかん]",
      ExpressionReading: "おいるこうかん",
      "kana:ExpressionFurigana": "おいるこうかん",
    });
  });

  it("uses Kiku's mora counter for odaka pitch positions", () => {
    expect(
      normalizeAnkiFields({
        ...ankiFieldsSkeleton,
        Expression: "今日",
        ExpressionFurigana: "今日[きょう;o]",
      }),
    ).toMatchObject({
      ExpressionReading: "きょう",
      PitchPosition: "2",
      PitchCategories: "odaka",
    });
  });

  it("does not attach a compound reading to only the final kanji run", () => {
    expect(
      normalizeAnkiFields({
        ...ankiFieldsSkeleton,
        Expression: "命の恩人",
        ExpressionFurigana: "命の恩人[いのちのおんじん;a]",
      }),
    ).toMatchObject({
      ExpressionFurigana: "命[いのち]の恩人[おんじん]",
      "furigana:ExpressionFurigana":
        "<ruby>命<rt>いのち</rt>の<rt></rt>恩人<rt>おんじん</rt></ruby>",
    });
  });

  it("does not reinterpret regular Kiku bracket furigana", () => {
    const fields = {
      ...ankiFieldsSkeleton,
      Expression: "大好き",
      ExpressionFurigana: "大好[だいす]き",
      ExpressionReading: "だいすき",
    };
    expect(normalizeAnkiFields(fields)).toBe(fields);
  });

  it("generates missing cached-note helpers without mutating the source", () => {
    const sourceFields = {
      Expression: { order: 0, value: "点滅" },
      ExpressionFurigana: { order: 1, value: "点滅[てんめつ;h]" },
      Sentence: { order: 2, value: "点滅する" },
      SentenceFurigana: { order: 3, value: "点滅[てんめつ;h]する" },
    };
    const note = {
      cards: [7],
      fields: sourceFields,
      mod: 1,
      modelName: "Kiku",
      noteId: 2,
      profile: "User 1",
      tags: [],
    };

    const result = normalizeAnkiNote(note);
    expect(result.modelName).toBe("Kiku");
    expect(result.fields.Expression).toEqual({ order: 0, value: "点滅" });
    expect(result.fields["furigana:ExpressionFurigana"]).toEqual({
      order: 1,
      value: "<ruby>点滅<rt>てんめつ</rt></ruby>",
    });
    expect(result.fields["kanji:Sentence"]).toEqual({ order: 2, value: "点滅する" });
    expect(sourceFields.ExpressionFurigana.value).toBe("点滅[てんめつ;h]");
  });
});
