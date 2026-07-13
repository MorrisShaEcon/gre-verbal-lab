import { describe, expect, it } from "vitest";
import { buildOpenDemoCatalog, extractExactCowAlignment } from "./build-open-demo.mjs";

function fixtureWord(overrides = {}) {
  const word = {
    id: "word-agree",
    headword: "agree",
    normalizedHeadword: "agree",
    pronunciations: [{ ipa: "əˈɡriː", dialect: "US", source: "test", quality: "dictionary_ipa", reviewState: "source_verified" }],
    audioSources: [],
    senses: [{
      id: "sense-agree",
      partOfSpeech: "v.",
      definitionZh: "来自私人表且不应发布的释义",
      definitionEn: "be in accord; be in agreement",
      sourceLabel: "private.xlsx",
      openSenseId: "agree%2:32:00::",
      usageNote: "private note",
      contextNote: "private note",
      examples: [{
        id: "example-agree",
        text: "They agree on the central point.",
        kind: "dictionary",
        sourceLabel: "Open English WordNet 2025",
        sourceUrl: "https://en-word.net/",
        provenance: "CC BY 4.0",
        reviewState: "source_verified",
        rightsState: "open_reuse",
        allowedIn: ["public", "private"],
      }],
      relations: { synonyms: ["concur"], antonyms: ["disagree"], confusables: [] },
      relationState: "verified",
      relationSource: "Open English WordNet 2025 synset oewn-00720565-v (CC BY 4.0)",
      relationEvidence: {
        synonyms: { state: "verified_present", source: "Open English WordNet 2025 synset oewn-00720565-v members (CC BY 4.0)" },
        antonyms: { state: "verified_present", source: "Open English WordNet 2025 lexical sense agree%2:32:00:: antonym relation (CC BY 4.0)" },
      },
      studyReviewState: "unreviewed",
      studyReviewNote: "",
      enrichmentState: "source_verified",
      alignmentState: "verified",
      alignmentScore: 1,
      alignmentSource: "Chinese Open Wordnet 1.4 via CILI i25696; exact: 同+意",
    }],
    sourceFiles: ["private.xlsx"],
    initialLapses: 3,
    sourceConsensus: true,
    frequencyProfile: { tier: "focus", rank: 1, priorityScore: 90, localMaterialCount: 4, officialMaterialCount: 2, evidenceBySource: { private: 2 } },
    order: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  return word;
}

describe("open demonstration catalog", () => {
  it("uses the exact COW lemma without inheriting a private replacement gloss", () => {
    const catalog = buildOpenDemoCatalog({ generatedAt: "2026-07-13T00:00:00.000Z", words: [fixtureWord()] }, { targetSize: 1, minimumStudyReady: 1 });
    const sense = catalog.words[0].senses[0];
    expect(sense.definitionZh).toBe("同意");
    expect(sense.definitionEn).toBe("be in accord; be in agreement");
    expect(sense.examples[0].text).toContain("agree");
    expect(sense.sourceLabel).toContain("i25696");
    expect(catalog.words[0].sourceFiles).not.toContain("private.xlsx");
  });

  it("does not leak editorial distractor targets that are absent from the open demo", () => {
    const word = fixtureWord();
    word.senses[0].relations.confusables = ["private-target"];
    word.senses[0].confusableSenseIds = ["sense-private-target"];
    word.senses[0].confusableRationales = { "sense-private-target": "Private rationale" };
    word.senses[0].confusableSource = "Private editorial review";
    const catalog = buildOpenDemoCatalog({ words: [word] }, { targetSize: 1, minimumStudyReady: 1 });
    expect(catalog.words[0].senses[0].relations.confusables).toEqual([]);
    expect(catalog.words[0].senses[0].confusableSenseIds).toEqual([]);
    expect(catalog.words[0].senses[0].confusableRationales).toEqual({});
    expect(catalog.words[0].senses[0].confusableSource).toBe("");
  });

  it("removes private GRE question text, source locators and match statistics", () => {
    const word = fixtureWord();
    word.senses[0].greQuestionMatches = [{
      id: "fixture-question-01",
      sourceLabel: "本地 GRE 机经题库",
      sourceFile: "fixtures/local-practice-bank.pdf",
      pageStart: 2,
      pageEnd: 2,
      locator: "Section 1 · Q1",
      questionType: "text_completion",
      questionText: "Private GRE source text",
      options: [{ label: "A", text: "agree" }, { label: "B", text: "disagree" }],
      answerValues: ["A"],
      matchedSurface: "agree",
      matchLocations: ["stem"],
      senseMatchState: "confirmed_sense",
      reviewNote: "Private semantic review",
    }];
    word.senses[0].greQuestionMatchStats = { reviewedBindings: 1, selectedMatches: 1 };
    const catalog = buildOpenDemoCatalog({
      generatedAt: "2026-07-13T00:00:00.000Z",
      greQuestionCorpusStats: { reviewedBindings: 1 },
      words: [word],
    }, { targetSize: 1, minimumStudyReady: 1 });
    const serialized = JSON.stringify(catalog);

    expect(catalog.words[0].senses[0]).not.toHaveProperty("greQuestionMatches");
    expect(catalog.words[0].senses[0]).not.toHaveProperty("greQuestionMatchStats");
    expect(serialized).not.toContain("Private GRE source text");
    expect(serialized).not.toContain("local-practice-bank.pdf");
    expect(serialized).not.toContain("greQuestionCorpusStats");
  });

  it("does not treat a partial COW overlap as a publishable definition", () => {
    const sense = fixtureWord().senses[0];
    sense.alignmentSource = "Chinese Open Wordnet 1.4 via CILI i25696; lemma-in-gloss: 同意";
    expect(extractExactCowAlignment(sense)).toBeUndefined();
  });

  it("does not treat an approximate CMU transcription as formal IPA", () => {
    const approximate = fixtureWord();
    approximate.pronunciations[0].quality = "approximate_transcription";
    expect(() => buildOpenDemoCatalog({ words: [approximate] }, { targetSize: 1, minimumStudyReady: 1 })).toThrow(/at least 1 study-ready primary words/);
  });

  it("does not publish a distractor-only support sense as an open-demo prompt", () => {
    const support = fixtureWord();
    support.senses[0].quizRole = "distractor_only";
    expect(() => buildOpenDemoCatalog({ words: [support] }, { targetSize: 1, minimumStudyReady: 1 })).toThrow(/at least 1 study-ready primary words/);
  });

  it("requires the displayed part of speech to match the OEWN sense key", () => {
    const mismatched = fixtureWord();
    mismatched.senses[0].partOfSpeech = "n.";
    expect(() => buildOpenDemoCatalog({ words: [mismatched] }, { targetSize: 1, minimumStudyReady: 1 })).toThrow(/at least 1 study-ready primary words/);
  });

  it("rejects an example that belongs to a different headword", () => {
    const word = fixtureWord();
    word.senses[0].examples[0].text = "They concur on the central point.";
    expect(() => buildOpenDemoCatalog({ words: [word] }, { targetSize: 1, minimumStudyReady: 1 })).toThrow(/at least 1 study-ready primary words/);
  });

  it("rejects relations without structured verified OEWN evidence", () => {
    const missingState = fixtureWord();
    delete missingState.senses[0].relationState;
    expect(() => buildOpenDemoCatalog({ words: [missingState] }, { targetSize: 1, minimumStudyReady: 1 })).toThrow(/at least 1 study-ready primary words/);

    const userSupplied = fixtureWord();
    userSupplied.senses[0].relationState = "user_supplied";
    userSupplied.senses[0].relationSource = "Local user note";
    expect(() => buildOpenDemoCatalog({ words: [userSupplied] }, { targetSize: 1, minimumStudyReady: 1 })).toThrow(/at least 1 study-ready primary words/);
  });

  it("accepts an aligned sense after both OEWN relation kinds were checked absent", () => {
    const checkedAbsent = fixtureWord();
    checkedAbsent.senses[0].relations = { synonyms: [], antonyms: [], confusables: [] };
    checkedAbsent.senses[0].relationEvidence = {
      synonyms: { state: "source_checked_absent", source: "Open English WordNet 2025 synset oewn-00720565-v members (CC BY 4.0)" },
      antonyms: { state: "source_checked_absent", source: "Open English WordNet 2025 lexical sense agree%2:32:00:: antonym relation (CC BY 4.0)" },
    };
    const catalog = buildOpenDemoCatalog({ words: [checkedAbsent] }, { targetSize: 1, minimumStudyReady: 1 });
    expect(catalog.words).toHaveLength(1);
  });
});
