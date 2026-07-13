import { describe, expect, it } from "vitest";
import { buildImportedWords, type CoreVocabularyRow, type SupplementVocabularyRow } from "./importers";

describe("vocabulary import merge", () => {
  it("uses the core list and enriches matching words with supplemental senses", () => {
    const core: CoreVocabularyRow[] = [
      { headword: "alpha", partOfSpeech: "n.", definition: "核心含义", lapses: 1, sourceFile: "core.xlsx" },
      { headword: "beta", partOfSpeech: "adj.", definition: "第二个含义", lapses: 0, sourceFile: "core.xlsx" },
    ];
    const supplement: SupplementVocabularyRow[] = [
      { headword: "alpha", definition: "n.补充含义一；\nn.补充含义二", sourceFile: "supplement.xlsx" },
      { headword: "outside", definition: "adj.范围外的", sourceFile: "supplement.xlsx" },
    ];
    const result = buildImportedWords(core, supplement, new Date("2026-07-12T00:00:00.000Z"));
    expect(result.words).toHaveLength(2);
    expect(result.words[0].headword).toBe("alpha");
    expect(result.words[0].senses.map((sense) => sense.definitionZh)).toEqual(["核心含义", "补充含义一", "补充含义二"]);
    expect(result.words[0].initialLapses).toBe(1);
    expect(result.words[0].senses.every((sense) => sense.relationState === "unverified")).toBe(true);
    expect(result.words[0].senses.every((sense) => sense.relationSource.length > 0)).toBe(true);
    expect(result.words[0].senses.every((sense) => (
      sense.relationEvidence.synonyms.state === "unverified"
      && sense.relationEvidence.antonyms.state === "unverified"
    ))).toBe(true);
    expect(result.enrichedWords).toBe(1);
  });
});
