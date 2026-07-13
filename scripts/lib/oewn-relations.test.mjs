import { describe, expect, it } from "vitest";
import { extractOewnRelations, lemmaFromSenseId, normalizeOewnLemma } from "./oewn-relations.mjs";

describe("OEWN lexical relation extraction", () => {
  it("normalizes member and sense-key lemmas", () => {
    expect(normalizeOewnLemma("High_Praise")).toBe("high praise");
    expect(lemmaFromSenseId("low_praise%1:10:00::")).toBe("low praise");
  });

  it("marks acclaim noun antonyms as source-checked absent without inventing one", () => {
    const result = extractOewnRelations({
      headword: "acclaim",
      trustedAlignment: true,
      reference: { id: "acclaim%1:10:00::", synset: "06704429-n" },
      synset: { members: ["acclaim", "acclamation", "plaudits", "plaudit", "eclat"] },
    });

    expect(result.relations.synonyms).toEqual(["acclamation", "plaudits", "plaudit", "eclat"]);
    expect(result.relations.antonyms).toEqual([]);
    expect(result.evidence.synonyms.state).toBe("verified_present");
    expect(result.evidence.antonyms.state).toBe("source_checked_absent");
    expect(result.evidence.antonyms.source).toContain("acclaim%1:10:00::");
  });

  it("extracts direct and reverse lexical antonym edges", () => {
    const result = extractOewnRelations({
      headword: "hot",
      trustedAlignment: true,
      reference: { id: "hot%3:00:01::", synset: "01247240-a", antonym: ["cold%3:00:01::"] },
      synset: { members: ["hot"] },
      reverseAntonymSenseIds: ["chilly%3:00:01::"],
    });

    expect(result.relations.antonyms).toEqual(["cold", "chilly"]);
    expect(result.evidence.synonyms.state).toBe("source_checked_absent");
    expect(result.evidence.antonyms.state).toBe("verified_present");
  });

  it("fails closed when the sense alignment is not trusted", () => {
    const result = extractOewnRelations({
      headword: "acclaim",
      trustedAlignment: false,
      reference: { id: "acclaim%1:10:00::", synset: "06704429-n" },
      synset: { members: ["acclaim", "acclamation"] },
    });

    expect(result.relations.synonyms).toEqual([]);
    expect(result.evidence.synonyms.state).toBe("unverified");
    expect(result.evidence.antonyms.state).toBe("unverified");
  });
});
