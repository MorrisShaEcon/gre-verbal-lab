import { describe, expect, it } from "vitest";
import { applyRating, buildDailyQueue, createDailyPlan, createLearningState, ensureDailyPlan, ensureLearningStates, exampleAllowedIn, exampleContainsHeadword, greQuestionMatchesFor, isDisplayableGreQuestionMatchState, isQuizTargetSense, isStudyReadySense, studyExamplesFor } from "./scheduler";
import { createEmptyData, stableId, type GreQuestionMatch, type WordEntry, type WordSense } from "./types";

function word(headword: string, order: number, tier: "focus" | "long-tail" = "focus", lapses = 0): WordEntry {
  const sense: WordSense = {
    id: stableId("sense", `${headword}|meaning`),
    partOfSpeech: "adj.",
    definitionZh: "测试释义",
    definitionEn: "test meaning",
    sourceLabel: "test",
    openSenseId: `${headword}%3:00:00::`,
    usageNote: "",
    contextNote: "",
    examples: [{
      id: stableId("ctx", `${headword}|example`),
      text: `The critic called the argument ${headword}.`,
      kind: "dictionary",
      sourceLabel: "test dictionary",
      provenance: "test license",
      reviewState: "source_verified",
      rightsState: "open_reuse",
      allowedIn: ["public", "private"],
    }],
    relations: { synonyms: ["test-synonym"], antonyms: [], confusables: [] },
    relationState: "verified",
    relationSource: "Open English WordNet 2025 synset test-a (CC BY 4.0)",
    relationEvidence: {
      synonyms: { state: "verified_present", source: "OEWN fixture synset" },
      antonyms: { state: "source_checked_absent", source: "OEWN fixture lexical sense" },
    },
    studyReviewState: "unreviewed",
    studyReviewNote: "",
    enrichmentState: "missing",
    alignmentState: "verified",
    alignmentScore: 1,
    alignmentSource: "Chinese Open Wordnet 1.4 via CILI i1; exact: 测试释义",
  };
  return {
    id: stableId("word", headword),
    headword,
    normalizedHeadword: headword,
    pronunciations: [{ ipa: "tɛst", dialect: "US", source: "test", quality: "dictionary_ipa", reviewState: "source_verified" }],
    audioSources: [],
    senses: [sense],
    sourceFiles: ["test"],
    initialLapses: lapses,
    sourceConsensus: false,
    frequencyProfile: { tier, rank: order + 1, priorityScore: 100 - order, localMaterialCount: 0, officialMaterialCount: 0, evidenceBySource: {} },
    order,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
}

describe("adaptive scheduler", () => {
  it("builds a stable 70/30 daily plan without alphabetical ordering", () => {
    const data = createEmptyData([], "test-catalog");
    data.words = [
      ...Array.from({ length: 24 }, (_, index) => word(`focus-${String.fromCharCode(97 + index)}`, index, "focus")),
      ...Array.from({ length: 12 }, (_, index) => word(`tail-${String.fromCharCode(97 + index)}`, index + 24, "long-tail")),
    ];
    data.learning = ensureLearningStates(data.words, {});
    data.settings.dailyNewWords = 20;
    const now = new Date("2026-07-12T09:00:00.000Z");
    const plan = createDailyPlan(data, now);
    const repeated = createDailyPlan(data, now);
    expect(plan.targetNewWords).toBe(20);
    expect(plan.focusCount).toBe(14);
    expect(plan.longTailCount).toBe(6);
    expect(new Set(plan.wordIds).size).toBe(20);
    expect(repeated.wordIds).toEqual(plan.wordIds);
    expect(plan.wordIds).not.toEqual([...plan.wordIds].sort());
    expect(createDailyPlan(data, new Date("2026-07-13T09:00:00.000Z")).wordIds).not.toEqual(plan.wordIds);
    expect(buildDailyQueue(data, now)).toHaveLength(20);
  });

  it("rebuilds a same-day plan when the normalized new-word target changes", () => {
    const data = createEmptyData(
      Array.from({ length: 30 }, (_, index) => word(`target-${index}`, index, index < 21 ? "focus" : "long-tail")),
      "goal-change-test",
    );
    const now = new Date("2026-07-13T09:00:00.000Z");
    data.settings.dailyNewWords = 20;
    const first = createDailyPlan(data, now);
    data.dailyPlans[first.date] = first;

    data.settings.dailyNewWords = 5;
    const rebuilt = createDailyPlan(data, now);
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.targetNewWords).toBe(5);
    expect(rebuilt.wordIds).toHaveLength(5);
    expect(rebuilt.seed).not.toBe(first.seed);

    const ensured = ensureDailyPlan(data, now);
    expect(ensured.dailyPlans[first.date]).toEqual(rebuilt);
  });

  it("subtracts new words already completed today when the target changes", () => {
    const data = createEmptyData(
      Array.from({ length: 30 }, (_, index) => word(`completed-${index}`, index, index < 21 ? "focus" : "long-tail")),
      "completed-goal-test",
    );
    const now = new Date("2026-07-13T09:00:00.000Z");
    data.settings.dailyNewWords = 5;
    const first = createDailyPlan(data, now);
    data.dailyPlans[first.date] = first;
    const completedIds = first.wordIds.slice(0, 3);
    for (const wordId of completedIds) {
      const completedWord = data.words.find((candidate) => candidate.id === wordId)!;
      data.learning[completedWord.senses[0].id] = {
        ...createLearningState(completedWord.senses[0], 0, now),
        reviewCount: 1,
        lastReviewedAt: now.toISOString(),
        nextReviewAt: "2026-07-14T09:00:00.000Z",
      };
    }

    data.settings.dailyNewWords = 8;
    const raised = createDailyPlan(data, now);
    const raisedPending = raised.wordIds.filter((wordId) => {
      const senseId = data.words.find((candidate) => candidate.id === wordId)!.senses[0].id;
      return (data.learning[senseId]?.reviewCount ?? 0) === 0;
    });
    expect(raised.wordIds).toEqual(expect.arrayContaining(completedIds));
    expect(raisedPending).toHaveLength(5);
    expect(raised.wordIds).toHaveLength(8);

    data.dailyPlans[first.date] = raised;
    data.settings.dailyNewWords = 2;
    const lowered = createDailyPlan(data, now);
    const loweredPending = lowered.wordIds.filter((wordId) => {
      const senseId = data.words.find((candidate) => candidate.id === wordId)!.senses[0].id;
      return (data.learning[senseId]?.reviewCount ?? 0) === 0;
    });
    expect(lowered.wordIds).toEqual(completedIds);
    expect(loweredPending).toHaveLength(0);
  });

  it("counts same-day first reviews from legacy unpersisted continuation batches", () => {
    const data = createEmptyData(
      Array.from({ length: 12 }, (_, index) => word(`legacy-extra-${index}`, index, index < 8 ? "focus" : "long-tail")),
      "legacy-extra-test",
    );
    const now = new Date("2026-07-13T09:00:00.000Z");
    data.settings.dailyNewWords = 5;
    const completedWords = data.words.slice(0, 2);
    for (const completedWord of completedWords) {
      const sense = completedWord.senses[0];
      data.learning[sense.id] = {
        ...createLearningState(sense, 0, now),
        reviewCount: 1,
        lastReviewedAt: now.toISOString(),
        nextReviewAt: "2026-07-14T09:00:00.000Z",
      };
      data.reviewEvents.push({
        id: `event-${sense.id}`,
        senseId: sense.id,
        wordId: completedWord.id,
        kind: "review",
        rating: "hard",
        confidence: 2,
        responseTimeMs: 1_000,
        reason: "legacy first review",
        note: "",
        reviewedAt: now.toISOString(),
      });
    }

    const plan = createDailyPlan(data, now);
    expect(plan.wordIds).toEqual(expect.arrayContaining(completedWords.map(({ id }) => id)));
    expect(plan.wordIds).toHaveLength(5);
    expect(plan.wordIds.filter((wordId) => !completedWords.some(({ id }) => id === wordId))).toHaveLength(3);
  });

  it("normalizes daily targets to 1-200 and replaces legacy plans without a target", () => {
    const data = createEmptyData(
      Array.from({ length: 220 }, (_, index) => word(`bounded-${index}`, index, index < 154 ? "focus" : "long-tail")),
      "goal-boundary-test",
    );
    const now = new Date("2026-07-13T09:00:00.000Z");

    data.settings.dailyNewWords = 0;
    const minimum = createDailyPlan(data, now);
    expect(minimum.targetNewWords).toBe(1);
    expect(minimum.wordIds).toHaveLength(1);

    data.settings.dailyNewWords = 999;
    const maximum = createDailyPlan(data, now);
    expect(maximum.targetNewWords).toBe(200);
    expect(maximum.wordIds).toHaveLength(200);

    data.settings.dailyNewWords = Number.NaN;
    const fallback = createDailyPlan(data, now);
    expect(fallback.targetNewWords).toBe(20);
    expect(fallback.wordIds).toHaveLength(20);

    const legacy = { ...fallback };
    delete legacy.targetNewWords;
    data.dailyPlans[fallback.date] = legacy;
    const upgraded = ensureDailyPlan(data, now);
    expect(upgraded.dailyPlans[fallback.date].targetNewWords).toBe(20);
    expect(upgraded.dailyPlans[fallback.date].wordIds).toEqual(fallback.wordIds);
    expect(upgraded.dailyPlans[fallback.date]).not.toBe(legacy);
  });

  it("schedules Again sooner than Good", () => {
    const sense = word("laconic", 0).senses[0];
    const initial = createLearningState(sense, 0, new Date("2026-07-12T09:00:00.000Z"));
    const now = new Date("2026-07-12T09:00:00.000Z");
    const again = applyRating(initial, "again", 2, 3_000, "2026-10-15", now);
    const good = applyRating(initial, "good", 2, 3_000, "2026-10-15", now);
    expect(new Date(again.nextReviewAt).getTime()).toBeLessThan(new Date(good.nextReviewAt).getTime());
    expect(again.lapseCount).toBe(initial.lapseCount + 1);
    expect(good.definitionMastery).toBeGreaterThan(initial.definitionMastery);
  });

  it("keeps blank, unsourced, or target-free examples out of the study queue", () => {
    const ready = word("captivate", 0);
    ready.senses[0].examples[0].text = "The speaker captivated the skeptical audience.";
    const blank = word("abash", 1);
    blank.senses[0].examples = [];
    const targetFree = word("abbreviate", 2);
    targetFree.senses[0].examples[0].text = "The manuscript must be shortened.";
    const originalOnly = word("obdurate", 3);
    originalOnly.senses[0].examples[0].kind = "original_gre_style";
    const unaligned = word("capricious", 4);
    unaligned.senses[0].alignmentState = "candidate";
    const noIpa = word("anatomize", 5);
    noIpa.pronunciations = [];
    const approximateIpa = word("acclaim", 10);
    approximateIpa.pronunciations[0].quality = "approximate_transcription";
    const heuristicAlignment = word("domesticate", 11);
    heuristicAlignment.senses[0].alignmentSource = "Chinese Open Wordnet 1.4 via CILI i1; lemma-in-gloss: 测试";
    const mismatchedPos = word("barring", 12);
    mismatchedPos.senses[0].partOfSpeech = "n.";
    const noRelations = word("customary", 6);
    noRelations.senses[0].relations = { synonyms: [], antonyms: [], confusables: [] };
    const checkedAbsent = word("univalent", 9);
    checkedAbsent.senses[0].relations = { synonyms: [], antonyms: [], confusables: [] };
    checkedAbsent.senses[0].relationEvidence = {
      synonyms: { state: "source_checked_absent", source: "OEWN fixture synset" },
      antonyms: { state: "source_checked_absent", source: "OEWN fixture lexical sense" },
    };
    const unverifiedRelations = word("dubious", 7);
    unverifiedRelations.senses[0].relationState = "unverified";
    unverifiedRelations.senses[0].relationSource = "No verified relation evidence";
    const userSuppliedRelations = word("private", 8);
    userSuppliedRelations.senses[0].relationState = "user_supplied";
    userSuppliedRelations.senses[0].relationSource = "Local user note";
    const data = createEmptyData([ready, blank, targetFree, originalOnly, unaligned, noIpa, noRelations, unverifiedRelations, userSuppliedRelations], "content-gate-test");
    data.learning = ensureLearningStates(data.words, {});
    data.settings.dailyNewWords = 4;
    const queue = buildDailyQueue(data, new Date("2026-07-13T09:00:00.000Z"));
    expect(queue.map((item) => item.word.headword)).toEqual(["captivate"]);
    expect(exampleContainsHeadword(ready.senses[0].examples[0], "captivate")).toBe(true);
    expect(isStudyReadySense(noIpa, noIpa.senses[0])).toBe(false);
    expect(isStudyReadySense(approximateIpa, approximateIpa.senses[0])).toBe(false);
    expect(isStudyReadySense(heuristicAlignment, heuristicAlignment.senses[0])).toBe(false);
    expect(isStudyReadySense(mismatchedPos, mismatchedPos.senses[0])).toBe(false);
    expect(isStudyReadySense(noRelations, noRelations.senses[0])).toBe(false);
    expect(isStudyReadySense(checkedAbsent, checkedAbsent.senses[0])).toBe(true);
    expect(isStudyReadySense(unverifiedRelations, unverifiedRelations.senses[0])).toBe(false);
    expect(isStudyReadySense(userSuppliedRelations, userSuppliedRelations.senses[0])).toBe(false);
  });

  it("schedules only one canonical row when source lists repeat the same OEWN sense", () => {
    const duplicate = word("axiomatic", 0);
    duplicate.senses.push({
      ...duplicate.senses[0],
      id: stableId("sense", "axiomatic|duplicate"),
      definitionZh: "不言自明的",
    });

    expect(isStudyReadySense(duplicate, duplicate.senses[0])).toBe(true);
    expect(isStudyReadySense(duplicate, duplicate.senses[1])).toBe(false);

    const data = createEmptyData([duplicate], "canonical-sense-test");
    data.learning = ensureLearningStates(data.words, {});
    data.learning[duplicate.senses[0].id].reviewCount = 1;
    data.learning[duplicate.senses[0].id].nextReviewAt = "2026-07-12T00:00:00.000Z";
    data.learning[duplicate.senses[1].id].reviewCount = 1;
    data.learning[duplicate.senses[1].id].nextReviewAt = "2026-07-12T00:00:00.000Z";
    expect(buildDailyQueue(data, new Date("2026-07-13T09:00:00.000Z"))).toHaveLength(1);
  });

  it("uses a distractor-only sense as validated content without scheduling it as a prompt", () => {
    const support = word("asunder", 0);
    support.senses[0].quizRole = "distractor_only";
    expect(isStudyReadySense(support, support.senses[0])).toBe(true);
    expect(isQuizTargetSense(support, support.senses[0])).toBe(false);

    const data = createEmptyData([support], "support-sense-test");
    data.learning = ensureLearningStates(data.words, {});
    data.settings.dailyNewWords = 1;
    expect(createDailyPlan(data, new Date("2026-07-13T09:00:00.000Z")).wordIds).toEqual([]);
    data.learning[support.senses[0].id].reviewCount = 1;
    data.learning[support.senses[0].id].nextReviewAt = "2026-07-12T00:00:00.000Z";
    expect(buildDailyQueue(data, new Date("2026-07-13T09:00:00.000Z"))).toEqual([]);
  });

  it("admits only examples whose structured rights allow private study", () => {
    const target = word("laconic", 0);
    const base = target.senses[0].examples[0];
    const example = (id: string, overrides: Partial<typeof base> = {}): typeof base => ({
      ...base,
      id,
      text: "Her laconic reply ended the debate.",
      ...overrides,
    });
    target.senses[0].examples = [
      example("dictionary", { kind: "dictionary", reviewState: "source_verified", rightsState: "open_reuse", allowedIn: ["public", "private"] }),
      example("gre", { kind: "gre_official", reviewState: "source_verified", rightsState: "private_user_held", allowedIn: ["private"] }),
      example("screen", { kind: "screen_dialogue", reviewState: "editor_reviewed", rightsState: "permission_granted", allowedIn: ["private"] }),
      example("copyrighted", { provenance: "All rights reserved; no permission recorded", rightsState: "restricted", allowedIn: ["private"] }),
      example("unknown", { rightsState: "unknown", allowedIn: ["private"] }),
      example("not-private", { rightsState: "open_reuse", allowedIn: ["public"] }),
      example("generated", { kind: "original_gre_style" }),
      example("private", { kind: "private_reference" }),
      example("candidate", { reviewState: "auto_candidate" }),
      example("no-label", { sourceLabel: " " }),
      example("no-provenance", { provenance: " " }),
      example("target-free", { text: "Her terse reply ended the debate." }),
    ];

    expect(studyExamplesFor(target, target.senses[0]).map(({ id }) => id)).toEqual(["dictionary", "gre", "screen"]);
    expect(studyExamplesFor(target, target.senses[0], "public").map(({ id }) => id)).toEqual(["dictionary", "not-private"]);
  });

  it("blocks legacy, unknown, restricted, and public GRE or screen examples even when labels exist", () => {
    const target = word("laconic", 0);
    const base = target.senses[0].examples[0];
    const legacy = { ...base } as Partial<typeof base>;
    delete legacy.rightsState;
    delete legacy.allowedIn;
    const misleadingGre: typeof base = { ...base, kind: "gre_official", rightsState: "permission_granted", allowedIn: ["public", "private"] };
    const misleadingScreen: typeof base = { ...base, kind: "screen_dialogue", rightsState: "permission_granted", allowedIn: ["public", "private"] };

    expect(exampleAllowedIn(legacy as typeof base, "private")).toBe(false);
    expect(exampleAllowedIn({ ...base, rightsState: "unknown", allowedIn: ["private"] }, "private")).toBe(false);
    expect(exampleAllowedIn({ ...base, rightsState: "restricted", allowedIn: ["private"] }, "private")).toBe(false);
    expect(exampleAllowedIn(misleadingGre, "public")).toBe(false);
    expect(exampleAllowedIn(misleadingScreen, "public")).toBe(false);
  });

  it("recognizes common inflections without accepting substring lookalikes", () => {
    const sample = word("run", 0).senses[0].examples[0];
    expect(exampleContainsHeadword({ ...sample, text: "She is running the study." }, "run")).toBe(true);
    expect(exampleContainsHeadword({ ...sample, text: "The findings were studied carefully." }, "study")).toBe(true);
    expect(exampleContainsHeadword({ ...sample, text: "His skill was obvious." }, "ill")).toBe(false);
  });

  it("returns complete private local GRE matches with confirmed senses first", () => {
    const target = word("laconic", 0);
    const valid = (id: string, overrides: Partial<GreQuestionMatch> = {}): GreQuestionMatch => ({
      id,
      sourceLabel: "GRE 机经 2026 私人资料",
      sourceFile: "机经/GRE填空题库.pdf",
      pageStart: 18,
      pageEnd: 18,
      locator: "第18页 · 第7题",
      questionType: "TC",
      questionText: "The review was so laconic that it left the committee puzzled.",
      options: [
        { label: "A", text: "terse" },
        { label: "B", text: "exhaustive" },
      ],
      answerValues: ["A"],
      matchedSurface: "laconic",
      matchLocations: [{ field: "questionText", start: 18, end: 25 }],
      senseMatchState: "word_form_only",
      reviewNote: "词形命中；等待或已完成义项核对。",
      ...overrides,
    });
    target.senses[0].greQuestionMatches = [
      valid("word-form"),
      valid("confirmed", { senseMatchState: "confirmed_sense", reviewNote: "语境与该义项一致。" }),
      valid("sentence-selection", {
        questionType: "reading_sentence_selection",
        options: [],
        answerValues: ["第二段第一句"],
        passageText: "The passage used laconic to characterize the review.",
        matchLocations: ["passage"],
      }),
      valid("remote", { sourceFile: "https://example.com/question" }),
      valid("missing-option", { options: [{ label: "A", text: "" }] }),
      valid("bad-pages", { pageStart: 20, pageEnd: 19 }),
      valid("bad-location", { matchLocations: [{ field: "option", start: 0, end: 3 }] }),
    ];

    expect(greQuestionMatchesFor(target.senses[0]).map(({ id }) => id)).toEqual(["confirmed", "word-form", "sentence-selection"]);
    expect(isDisplayableGreQuestionMatchState("confirmed_sense")).toBe(true);
    expect(isDisplayableGreQuestionMatchState("word_form_only")).toBe(true);
    expect(isDisplayableGreQuestionMatchState("rejected")).toBe(false);
    expect(isDisplayableGreQuestionMatchState("corrupt-state")).toBe(false);
  });

  it("keeps GRE question matches independent from the existing study gate", () => {
    const ready = word("laconic", 0);
    ready.senses[0].greQuestionMatches = [];
    expect(isStudyReadySense(ready, ready.senses[0])).toBe(true);

    const questionOnly = word("obscure", 1);
    questionOnly.senses[0].examples = [];
    questionOnly.senses[0].greQuestionMatches = [{
      id: "question-only",
      sourceLabel: "本地机经",
      sourceFile: "private/question-bank.pdf",
      pageStart: 1,
      pageEnd: 1,
      locator: "p1q1",
      questionType: "SE",
      questionText: "The argument remained obscure.",
      options: [{ label: "A", text: "unclear" }, { label: "B", text: "plain" }],
      matchedSurface: "obscure",
      matchLocations: ["questionText:22-29"],
      senseMatchState: "confirmed_sense",
      reviewNote: "人工核对通过。",
    }];
    expect(greQuestionMatchesFor(questionOnly.senses[0])).toHaveLength(1);
    expect(isStudyReadySense(questionOnly, questionOnly.senses[0])).toBe(false);
  });
});
