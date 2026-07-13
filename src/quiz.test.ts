import { describe, expect, it } from "vitest";
import { createLearningState } from "./scheduler";
import { applyDefinitionQuizAnswer, createDefinitionQuizQuestion, evaluateDefinitionQuizAnswer } from "./quiz";
import { stableId, type WordEntry, type WordSense } from "./types";

function makeWord(
  headword: string,
  definitionZh: string,
  order: number,
  relations: Partial<WordSense["relations"]> = {},
  options: {
    partOfSpeech?: string;
    openSenseId?: string;
    alignmentSource?: string;
    studyReady?: boolean;
  } = {},
): WordEntry {
  const partOfSpeech = options.partOfSpeech ?? "adj.";
  const senseKeyCode = partOfSpeech.toLowerCase().startsWith("n")
    ? "1"
    : partOfSpeech.toLowerCase().startsWith("v")
      ? "2"
      : partOfSpeech.toLowerCase().startsWith("adv")
        ? "4"
        : "3";
  const sense: WordSense = {
    id: stableId("sense", `${headword}|${definitionZh}`),
    partOfSpeech,
    definitionZh,
    definitionEn: definitionZh,
    sourceLabel: "test",
    openSenseId: options.openSenseId ?? `${headword}%${senseKeyCode}:00:00::`,
    usageNote: "",
    contextNote: "",
    examples: [{
      id: stableId("example", headword),
      text: `A ${headword} example.`,
      kind: "dictionary",
      sourceLabel: "Test Dictionary",
      provenance: "CC BY 4.0",
      reviewState: "source_verified",
      rightsState: "open_reuse",
      allowedIn: ["public", "private"],
    }],
    relations: {
      synonyms: relations.synonyms ?? [],
      antonyms: relations.antonyms ?? [],
      confusables: relations.confusables ?? [],
    },
    relationState: "verified",
    relationSource: "Open English WordNet 2025 synset test-a (CC BY 4.0)",
    relationEvidence: {
      synonyms: { state: relations.synonyms?.length ? "verified_present" : "source_checked_absent", source: "OEWN fixture synset" },
      antonyms: { state: relations.antonyms?.length ? "verified_present" : "source_checked_absent", source: "OEWN fixture lexical sense" },
    },
    studyReviewState: "editor_approved",
    studyReviewNote: "Test fixture",
    enrichmentState: "editor_reviewed",
    alignmentState: "verified",
    alignmentScore: 1,
    alignmentSource: options.alignmentSource ?? `Chinese Open Wordnet 1.4 via CILI i${1_000 + order}; exact: 测试义`,
  };
  return {
    id: stableId("word", headword),
    headword,
    normalizedHeadword: headword,
    pronunciations: options.studyReady === false ? [] : [{
      ipa: "tɛst",
      dialect: "US",
      source: "Test Dictionary",
      quality: "dictionary_ipa",
      reviewState: "source_verified",
    }],
    audioSources: [],
    senses: [sense],
    sourceFiles: ["test"],
    initialLapses: 0,
    sourceConsensus: false,
    frequencyProfile: {
      tier: "focus",
      rank: order + 1,
      priorityScore: 100 - order,
      localMaterialCount: 0,
      officialMaterialCount: 0,
      evidenceBySource: {},
    },
    order,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
}

const catalog = [
  makeWord("laconic", "言简意赅的", 0, { synonyms: ["concise"], antonyms: ["verbose"], confusables: ["aconitic"] }),
  makeWord("concise", "简明扼要的", 1, { synonyms: ["laconic"] }),
  makeWord("verbose", "冗长啰嗦的", 2),
  makeWord("aconitic", "乌头属植物的", 3, { confusables: ["laconic"] }),
  makeWord("prudent", "谨慎明智的", 4),
  makeWord("capricious", "反复无常的", 5),
  makeWord("obdurate", "顽固不化的", 6),
  makeWord("munificent", "极其慷慨的", 7),
  makeWord("scrupulous", "小心谨慎的", 8),
  makeWord("wary", "谨慎的", 9),
  makeWord("exacting", "小心谨慎的，挑剔的", 10),
];

describe("definition multiple-choice engine", () => {
  it("rejects a distractor-only haphazard support sense as a question stem", () => {
    const support = makeWord("haphazard", "无秩序地；草率地", 12, {}, { partOfSpeech: "adv." });
    support.senses[0].quizRole = "distractor_only";

    expect(() => createDefinitionQuizQuestion({
      word: support,
      sense: support.senses[0],
      catalogWords: [support, ...catalog],
      attemptSeed: "support-sense-boundary",
    })).toThrow("该词义仅用于干扰项，不能作为题干。");
  });

  it("creates one stable correct answer and three unambiguous distractors", () => {
    const target = catalog[0];
    const input = { word: target, sense: target.senses[0], catalogWords: catalog, attemptSeed: "attempt-1" };
    const first = createDefinitionQuizQuestion(input);
    const repeated = createDefinitionQuizQuestion(input);
    expect(first).toEqual(repeated);
    expect(first.options).toHaveLength(4);
    expect(new Set(first.options.map((option) => option.id)).size).toBe(4);
    expect(first.options.filter((option) => option.id === first.correctOptionId)).toHaveLength(1);
    expect(first.options.find((option) => option.id === first.correctOptionId)?.text).toBe("言简意赅的");
    // A synonym definition must not become a second defensible answer.
    expect(first.options.map((option) => option.text)).not.toContain("简明扼要的");
    expect(first.distractorSenseIds).toContain(catalog[3].senses[0].id);
  });

  it("turns a wrong choice into an observed lapse and a short retry", () => {
    const target = catalog[0];
    const question = createDefinitionQuizQuestion({ word: target, sense: target.senses[0], catalogWords: catalog, attemptSeed: 2 });
    const wrong = question.options.find((option) => option.id !== question.correctOptionId)!;
    const previous = createLearningState(target.senses[0], 0, new Date("2026-07-13T09:00:00.000Z"));
    const now = new Date("2026-07-13T09:00:00.000Z");
    const result = applyDefinitionQuizAnswer({
      question,
      selectedOptionId: wrong.id,
      previousLearning: previous,
      responseTimeMs: 8_000,
      examDate: "2026-10-15",
      now,
    });
    expect(result.evaluation.isCorrect).toBe(false);
    expect(result.evaluation.rating).toBe("again");
    expect(result.evaluation.masteryDecision).toBe("not_mastered");
    expect(result.learning.lapseCount).toBe(previous.lapseCount + 1);
    expect(new Date(result.learning.nextReviewAt).getTime() - now.getTime()).toBe(10 * 60 * 1_000);
  });

  it("does not offer a paraphrase or a definition containing the correct meaning as a distractor", () => {
    const target = catalog.find((word) => word.headword === "scrupulous")!;
    const question = createDefinitionQuizQuestion({ word: target, sense: target.senses[0], catalogWords: catalog, attemptSeed: "meaning-overlap" });
    expect(question.options.map((option) => option.text)).not.toContain("谨慎的");
    expect(question.options.map((option) => option.text)).not.toContain("小心谨慎的，挑剔的");
  });

  it("admits only distractor senses that pass the complete formal-study gate", () => {
    const target = catalog[0];
    const notReady = makeWord("specious", "似是而非的", 20, {}, { studyReady: false });
    const question = createDefinitionQuizQuestion({
      word: target,
      sense: target.senses[0],
      catalogWords: [...catalog, notReady],
      attemptSeed: "formal-gate",
    });
    expect(question.distractorSenseIds).not.toContain(notReady.senses[0].id);
  });

  it("rejects distractors sharing the target open sense or CILI concept", () => {
    const target = makeWord("lucid", "清晰易懂的", 30);
    const sameOpenSense = makeWord("pellucid", "完全透明的", 31, {}, {
      openSenseId: target.senses[0].openSenseId!,
    });
    const sameCili = makeWord("limpid", "水质澄澈的", 32, {}, {
      alignmentSource: target.senses[0].alignmentSource,
    });
    const pool = [
      target,
      sameOpenSense,
      sameCili,
      makeWord("obdurate", "顽固不化的", 33),
      makeWord("munificent", "极其慷慨的", 34),
      makeWord("capricious", "反复无常的", 35),
      makeWord("taciturn", "沉默寡言的", 36),
    ];
    const question = createDefinitionQuizQuestion({
      word: target,
      sense: target.senses[0],
      catalogWords: pool,
      attemptSeed: "concept-unique",
    });
    expect(question.distractorSenseIds).not.toContain(sameOpenSense.senses[0].id);
    expect(question.distractorSenseIds).not.toContain(sameCili.senses[0].id);
  });

  it("uses three same-part-of-speech distractors when that formal pool is sufficient", () => {
    const target = makeWord("temperate", "温和克制的", 40, { confusables: ["enticement"] });
    const crossPartOfSpeech = makeWord("enticement", "诱惑物", 41, { confusables: ["temperate"] }, {
      partOfSpeech: "n.",
    });
    const samePartOfSpeech = [
      makeWord("obdurate", "顽固不化的", 42),
      makeWord("munificent", "极其慷慨的", 43),
      makeWord("capricious", "反复无常的", 44),
      makeWord("taciturn", "沉默寡言的", 45),
    ];
    const pool = [target, crossPartOfSpeech, ...samePartOfSpeech];
    const question = createDefinitionQuizQuestion({
      word: target,
      sense: target.senses[0],
      catalogWords: pool,
      attemptSeed: "same-pos-first",
    });
    const bySenseId = new Map(pool.flatMap((word) => word.senses.map((sense) => [sense.id, sense] as const)));
    expect(question.distractorSenseIds).not.toContain(crossPartOfSpeech.senses[0].id);
    expect(question.distractorSenseIds.every((senseId) => bySenseId.get(senseId)?.partOfSpeech === "adj.")).toBe(true);
  });

  it("does not boost a look-alike word without an explicit lexical relation", () => {
    const target = makeWord("acclaim", "称赞", 100, {}, { partOfSpeech: "n." });
    const spellingOnly = makeWord("ascetic", "苦行者", 900, {}, { partOfSpeech: "n." });
    const pool = [
      target,
      spellingOnly,
      makeWord("artifact", "人工制品", 101, {}, { partOfSpeech: "n." }),
      makeWord("candor", "坦率", 102, {}, { partOfSpeech: "n." }),
      makeWord("dogma", "教条", 103, {}, { partOfSpeech: "n." }),
      makeWord("impasse", "僵局", 104, {}, { partOfSpeech: "n." }),
    ];
    const question = createDefinitionQuizQuestion({
      word: target,
      sense: target.senses[0],
      catalogWords: pool,
      attemptSeed: "no-spelling-boost",
    });
    expect(question.distractorSenseIds).not.toContain(spellingOnly.senses[0].id);
  });

  it("prioritizes a learner's previously chosen wrong sense", () => {
    const target = catalog[0];
    const previouslyChosen = catalog.find((word) => word.headword === "prudent")!.senses[0];
    const question = createDefinitionQuizQuestion({
      word: target,
      sense: target.senses[0],
      catalogWords: catalog,
      attemptSeed: "personal-confusion",
      preferredDistractorSenseIds: [previouslyChosen.id],
    });
    expect(question.distractorSenseIds).toContain(previouslyChosen.id);
  });

  it("binds an editorial confusable to the reviewed sense of a polysemous word", () => {
    const target = makeWord("laconic", "言简意赅的", 200, { confusables: ["temperate"] });
    const candidate = makeWord("temperate", "温和克制的", 201);
    const alternateSense = makeWord("temperate", "气候温和的", 202).senses[0];
    candidate.senses.push(alternateSense);
    target.senses[0].confusableSenseIds = [candidate.senses[0].id];
    const pool = [
      target,
      candidate,
      makeWord("obdurate", "顽固不化的", 203),
      makeWord("munificent", "极其慷慨的", 204),
      makeWord("capricious", "反复无常的", 205),
      makeWord("taciturn", "沉默寡言的", 206),
    ];
    const question = createDefinitionQuizQuestion({
      word: target,
      sense: target.senses[0],
      catalogWords: pool,
      attemptSeed: "exact-confusable-sense",
    });
    expect(question.distractorSenseIds).toContain(candidate.senses[0].id);
    expect(question.distractorSenseIds).not.toContain(alternateSense.id);
  });

  it("does not mistake a first multiple-choice hit for mastery", () => {
    const target = catalog[0];
    const question = createDefinitionQuizQuestion({ word: target, sense: target.senses[0], catalogWords: catalog, attemptSeed: 3 });
    const previous = createLearningState(target.senses[0]);
    const evaluation = evaluateDefinitionQuizAnswer(question, question.correctOptionId, previous, 4_000);
    expect(evaluation.isCorrect).toBe(true);
    expect(evaluation.rating).toBe("hard");
    expect(evaluation.masteryDecision).toBe("learning");
  });

  it("requires confirmation after a first hit without trapping correct answers at Hard forever", () => {
    const target = catalog[0];
    const question = createDefinitionQuizQuestion({ word: target, sense: target.senses[0], catalogWords: catalog, attemptSeed: 31 });
    const first = {
      ...createLearningState(target.senses[0]),
      reviewCount: 1,
      definitionMastery: 7,
      lastRating: "hard" as const,
    };
    const confirmation = evaluateDefinitionQuizAnswer(question, question.correctOptionId, first, 8_000);
    const confirmed = evaluateDefinitionQuizAnswer(
      question,
      question.correctOptionId,
      { ...first, reviewCount: 2, definitionMastery: 14 },
      8_000,
    );
    expect(confirmation.rating).toBe("hard");
    expect(confirmed.rating).toBe("good");
  });

  it("infers fluency only after repeated prior learning and a fast correct answer", () => {
    const target = catalog[0];
    const question = createDefinitionQuizQuestion({ word: target, sense: target.senses[0], catalogWords: catalog, attemptSeed: 4 });
    const previous = {
      ...createLearningState(target.senses[0]),
      reviewCount: 4,
      definitionMastery: 68,
      lastRating: "good" as const,
    };
    const evaluation = evaluateDefinitionQuizAnswer(question, question.correctOptionId, previous, 4_500);
    expect(evaluation.rating).toBe("easy");
    expect(evaluation.inferredConfidence).toBe(3);
    expect(evaluation.masteryDecision).toBe("fluent");
  });

  it("supports a timing-unscored accessibility mode", () => {
    const target = catalog[0];
    const question = createDefinitionQuizQuestion({ word: target, sense: target.senses[0], catalogWords: catalog, attemptSeed: 5 });
    const previous = {
      ...createLearningState(target.senses[0]),
      reviewCount: 2,
      definitionMastery: 60,
      lastRating: "good" as const,
    };
    const evaluation = evaluateDefinitionQuizAnswer(question, question.correctOptionId, previous, 120_000, false);
    expect(evaluation.rating).toBe("good");
    expect(evaluation.responseBand).toBe("timing_unscored");
    expect(evaluation.masteryDecision).toBe("remembered");
  });

  it("still treats a just-corrected lapse conservatively when timing is disabled", () => {
    const target = catalog[0];
    const question = createDefinitionQuizQuestion({ word: target, sense: target.senses[0], catalogWords: catalog, attemptSeed: 51 });
    const previous = {
      ...createLearningState(target.senses[0]),
      reviewCount: 5,
      definitionMastery: 72,
      lastRating: "again" as const,
    };
    const evaluation = evaluateDefinitionQuizAnswer(question, question.correctOptionId, previous, 120_000, false);
    expect(evaluation.rating).toBe("hard");
    expect(evaluation.masteryDecision).toBe("learning");
  });

  it("uses an inclusive six-second fluency boundary", () => {
    const target = catalog[0];
    const question = createDefinitionQuizQuestion({ word: target, sense: target.senses[0], catalogWords: catalog, attemptSeed: 52 });
    const previous = {
      ...createLearningState(target.senses[0]),
      reviewCount: 4,
      definitionMastery: 68,
      lastRating: "good" as const,
    };
    expect(evaluateDefinitionQuizAnswer(question, question.correctOptionId, previous, 6_000).rating).toBe("easy");
    expect(evaluateDefinitionQuizAnswer(question, question.correctOptionId, previous, 6_001).rating).toBe("good");
  });

  it("rejects forged options and neutralizes invalid response-time telemetry", () => {
    const target = catalog[0];
    const question = createDefinitionQuizQuestion({ word: target, sense: target.senses[0], catalogWords: catalog, attemptSeed: 53 });
    const previous = {
      ...createLearningState(target.senses[0]),
      reviewCount: 4,
      definitionMastery: 68,
      lastRating: "good" as const,
    };
    expect(() => evaluateDefinitionQuizAnswer(question, "option-forged", previous, 2_000)).toThrow("所选答案不属于当前题目");
    const result = applyDefinitionQuizAnswer({
      question,
      selectedOptionId: question.correctOptionId,
      previousLearning: previous,
      responseTimeMs: Number.NaN,
      examDate: "2026-10-15",
      now: new Date("2026-07-13T09:00:00.000Z"),
    });
    expect(result.evaluation.rating).toBe("good");
    expect(result.learning.lastResponseTimeMs).toBe(10_001);
    expect(Number.isFinite(result.learning.lastResponseTimeMs)).toBe(true);
  });
});
