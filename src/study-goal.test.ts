import { describe, expect, it } from "vitest";
import {
  collectRemainingPrimaryTargets,
  forecastRemainingPrimaryTargets,
  forecastStudyGoal,
  normalizeDailyNewWordGoal,
  persistAdditionalNewWordBatch,
  restoreActiveStudySession,
  selectAdditionalNewWordBatch,
  updateActiveStudySessionProgress,
} from "./study-goal";
import { ensureDailyPlan, localDateKey } from "./scheduler";
import { createEmptyData, stableId, type WordEntry, type WordSense } from "./types";

function readyWord(
  headword: string,
  order: number,
  tier: "focus" | "long-tail" | "unranked" = "focus",
): WordEntry {
  const sense: WordSense = {
    id: stableId("sense", `${headword}|primary`),
    partOfSpeech: "adj.",
    definitionZh: `${headword} 的释义`,
    definitionEn: `${headword} meaning`,
    sourceLabel: "test",
    openSenseId: `${headword}%3:00:00::`,
    usageNote: "",
    contextNote: "",
    examples: [{
      id: stableId("ctx", `${headword}|example`),
      text: `The reviewer found the argument ${headword}.`,
      kind: "dictionary",
      sourceLabel: "test dictionary",
      provenance: "test license",
      reviewState: "source_verified",
      rightsState: "open_reuse",
      allowedIn: ["public", "private"],
    }],
    relations: { synonyms: ["fixture"], antonyms: [], confusables: [] },
    relationState: "verified",
    relationSource: "Open English WordNet 2025 fixture (CC BY 4.0)",
    relationEvidence: {
      synonyms: { state: "verified_present", source: "OEWN fixture synset" },
      antonyms: { state: "source_checked_absent", source: "OEWN fixture lexical sense" },
    },
    studyReviewState: "editor_approved",
    studyReviewNote: "fixture",
    enrichmentState: "editor_reviewed",
    alignmentState: "verified",
    alignmentScore: 1,
    alignmentSource: "Chinese Open Wordnet 1.4 via CILI i1; exact: 测试释义",
  };
  return {
    id: stableId("word", headword),
    headword,
    normalizedHeadword: headword,
    pronunciations: [{
      ipa: "/tɛst/",
      dialect: "US",
      source: "test",
      quality: "dictionary_ipa",
      reviewState: "source_verified",
    }],
    audioSources: [],
    senses: [sense],
    sourceFiles: ["test"],
    initialLapses: 0,
    sourceConsensus: true,
    frequencyProfile: {
      tier,
      rank: order + 1,
      priorityScore: Math.max(1, 100 - order),
      localMaterialCount: 0,
      officialMaterialCount: 0,
      evidenceBySource: {},
    },
    order,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
}

function catalog(focus = 30, longTail = 15) {
  const words = [
    ...Array.from({ length: focus }, (_, index) => readyWord(`focus-${index}`, index, "focus")),
    ...Array.from({ length: longTail }, (_, index) => readyWord(`tail-${index}`, focus + index, "long-tail")),
  ];
  const data = createEmptyData(words, "study-goal-test");
  data.settings.dailyNewWords = 20;
  return data;
}

describe("study goal logic", () => {
  it("normalizes editable daily goals to a safe 1-200 range with a default of 20", () => {
    expect(normalizeDailyNewWordGoal(undefined)).toBe(20);
    expect(normalizeDailyNewWordGoal(Number.NaN)).toBe(20);
    expect(normalizeDailyNewWordGoal(0)).toBe(1);
    expect(normalizeDailyNewWordGoal(27.9)).toBe(27);
    expect(normalizeDailyNewWordGoal(999)).toBe(200);
  });

  it("calculates study days and an inclusive local completion date", () => {
    expect(forecastStudyGoal(95, 20, new Date(2026, 6, 13))).toEqual({
      dailyNewWordGoal: 20,
      remainingTargetCount: 95,
      studyDays: 5,
      startDate: "2026-07-13",
      estimatedCompletionDate: "2026-07-17",
    });
    expect(forecastStudyGoal(0, 20, new Date(2026, 6, 13)).estimatedCompletionDate).toBe("2026-07-13");
  });

  it("counts only unseen, unscheduled, quiz-ready primary targets", () => {
    const data = catalog(6, 3);
    const learned = data.words[0];
    data.learning[learned.senses[0].id] = {
      senseId: learned.senses[0].id,
      reviewCount: 1,
      lapseCount: 0,
      stabilityDays: 1,
      difficulty: 5,
      definitionMastery: 10,
      relationshipMastery: 0,
      contextMastery: 0,
      lastReviewedAt: "2026-07-13T00:00:00.000Z",
      nextReviewAt: "2026-07-14T00:00:00.000Z",
      lastRating: "good",
      lastConfidence: 2,
      lastResponseTimeMs: 1_000,
      scheduleReason: "test",
    };
    const stored = data.words[1];
    data.dailyPlans["2026-07-13"] = {
      date: "2026-07-13",
      catalogVersion: data.catalogVersion,
      seed: 1,
      wordIds: [stored.id],
      focusCount: 1,
      longTailCount: 0,
      generatedAt: "2026-07-13T00:00:00.000Z",
    };
    const support = data.words[2];
    support.senses[0].quizRole = "distractor_only";
    const inMemoryScheduled = data.words[3];

    const remaining = collectRemainingPrimaryTargets(data, {
      scheduledWordIds: [inMemoryScheduled.id],
    });
    expect(remaining).toHaveLength(5);
    expect(remaining.map(({ word }) => word.id)).not.toContain(learned.id);
    expect(remaining.map(({ word }) => word.id)).not.toContain(stored.id);
    expect(remaining.map(({ word }) => word.id)).not.toContain(support.id);
    expect(remaining.map(({ word }) => word.id)).not.toContain(inMemoryScheduled.id);
    expect(forecastRemainingPrimaryTargets(data, {
      scheduledWordIds: [inMemoryScheduled.id],
      dailyNewWordGoal: 2,
      startDate: new Date(2026, 6, 13),
    }).studyDays).toBe(3);
  });

  it("selects a deterministic, unique 70/30 extra batch", () => {
    const data = catalog();
    const batch = selectAdditionalNewWordBatch(data, { seedKey: "first-extra" });
    const repeated = selectAdditionalNewWordBatch(data, { seedKey: "first-extra" });

    expect(batch.selectedCount).toBe(20);
    expect(batch.focusCount).toBe(14);
    expect(batch.longTailCount).toBe(6);
    expect(new Set(batch.wordIds).size).toBe(20);
    expect(repeated.wordIds).toEqual(batch.wordIds);
    expect(batch.wordIds).not.toEqual([...batch.wordIds].sort());
  });

  it("uses the user's chosen batch size and never repeats learned or previously queued words", () => {
    const data = catalog(12, 8);
    data.settings.dailyNewWords = 7;
    const first = selectAdditionalNewWordBatch(data, { seedKey: "continue" });
    expect(first.selectedCount).toBe(7);

    const learned = data.words.find((word) => !first.wordIds.includes(word.id))!;
    data.learning[learned.senses[0].id] = {
      senseId: learned.senses[0].id,
      reviewCount: 2,
      lapseCount: 0,
      stabilityDays: 2,
      difficulty: 4,
      definitionMastery: 20,
      relationshipMastery: 0,
      contextMastery: 0,
      lastReviewedAt: "2026-07-13T00:00:00.000Z",
      nextReviewAt: "2026-07-15T00:00:00.000Z",
      lastRating: "good",
      lastConfidence: 2,
      lastResponseTimeMs: 900,
      scheduleReason: "test",
    };

    const second = selectAdditionalNewWordBatch(data, {
      requestedCount: 5,
      scheduledWordIds: first.wordIds,
      seedKey: "continue",
    });
    expect(second.selectedCount).toBe(5);
    expect(second.wordIds).not.toContain(learned.id);
    expect(second.wordIds.some((id) => first.wordIds.includes(id))).toBe(false);
  });

  it("fills a 70/30 shortfall from the available tier without exceeding the pool", () => {
    const data = catalog(2, 8);
    const batch = selectAdditionalNewWordBatch(data, { requestedCount: 8, seedKey: "shortfall" });
    expect(batch.selectedCount).toBe(8);
    expect(batch.focusCount).toBe(2);
    expect(batch.longTailCount).toBe(6);
    expect(batch.remainingAfter).toBe(2);
  });

  it("persists a continuation batch and resumes its exact remaining order after reload", () => {
    const now = new Date(2026, 6, 13, 9, 0, 0);
    const planned = ensureDailyPlan(catalog(30, 15), now);
    const originalPlan = planned.dailyPlans[localDateKey(now)];
    const batch = selectAdditionalNewWordBatch(planned, {
      requestedCount: 6,
      seedKey: "persisted-extra",
    });

    const persisted = persistAdditionalNewWordBatch(planned, batch, now);
    const persistedPlan = persisted.dailyPlans[localDateKey(now)];
    expect(persistedPlan.wordIds).toEqual([...originalPlan.wordIds, ...batch.wordIds]);
    expect(persistedPlan.activeSession?.queueSenseIds).toEqual(batch.senseIds);
    expect(persistedPlan.activeSession?.nextIndex).toBe(0);

    const retryQueue = [...batch.senseIds, batch.senseIds[0]];
    const progressed = updateActiveStudySessionProgress(persisted, {
      sessionId: persistedPlan.activeSession!.id,
      queueSenseIds: retryQueue,
      nextIndex: 2,
      now,
    });
    const reloaded = JSON.parse(JSON.stringify(progressed)) as typeof progressed;
    const restored = restoreActiveStudySession(reloaded, now);
    expect(restored).not.toBeNull();
    expect(restored!.session.nextIndex).toBe(2);
    expect(restored!.session.queueSenseIds).toEqual(retryQueue);
    expect(restored!.queue.map(({ sense }) => sense.id).slice(restored!.session.nextIndex)).toEqual(retryQueue.slice(2));

    const completed = updateActiveStudySessionProgress(reloaded, {
      sessionId: restored!.session.id,
      queueSenseIds: retryQueue,
      nextIndex: retryQueue.length,
      now,
    });
    expect(restoreActiveStudySession(completed, now)).toBeNull();
    expect(completed.dailyPlans[localDateKey(now)].wordIds).toEqual([...originalPlan.wordIds, ...batch.wordIds]);
  });

  it("keeps a continuation session bound to its original plan across midnight", () => {
    const beforeMidnight = new Date(2026, 6, 13, 23, 59, 0);
    const afterMidnight = new Date(2026, 6, 14, 0, 1, 0);
    const dayOne = ensureDailyPlan(catalog(40, 20), beforeMidnight);
    const batch = selectAdditionalNewWordBatch(dayOne, {
      requestedCount: 5,
      seedKey: "midnight-extra",
    });
    const persisted = persistAdditionalNewWordBatch(dayOne, batch, beforeMidnight);
    const sessionId = persisted.dailyPlans["2026-07-13"].activeSession!.id;
    const withNextDayPlan = ensureDailyPlan(persisted, afterMidnight);
    const retryQueue = [...batch.senseIds, batch.senseIds[0]];

    const progressed = updateActiveStudySessionProgress(withNextDayPlan, {
      sessionId,
      queueSenseIds: retryQueue,
      nextIndex: 2,
      now: afterMidnight,
    });

    expect(progressed.dailyPlans["2026-07-13"].activeSession?.nextIndex).toBe(2);
    expect(progressed.dailyPlans["2026-07-13"].activeSession?.updatedAt).toBe(afterMidnight.toISOString());
    expect(progressed.dailyPlans["2026-07-14"].activeSession).toBeUndefined();

    const reloaded = JSON.parse(JSON.stringify(progressed)) as typeof progressed;
    const restored = restoreActiveStudySession(reloaded, afterMidnight);
    expect(restored?.session.id).toBe(sessionId);
    expect(restored?.session.date).toBe("2026-07-13");
    expect(restored?.queue.map(({ sense }) => sense.id)).toEqual(retryQueue);

    const completed = updateActiveStudySessionProgress(reloaded, {
      sessionId,
      queueSenseIds: retryQueue,
      nextIndex: retryQueue.length,
      now: afterMidnight,
    });
    expect(completed.dailyPlans["2026-07-13"].activeSession).toBeUndefined();
    expect(restoreActiveStudySession(completed, afterMidnight)).toBeNull();
  });

  it("treats legacy plans without an active session as safely resumable data", () => {
    const now = new Date(2026, 6, 13, 9, 0, 0);
    const planned = ensureDailyPlan(catalog(8, 4), now);
    const legacy = JSON.parse(JSON.stringify(planned)) as typeof planned;
    delete legacy.dailyPlans[localDateKey(now)].targetNewWords;
    delete legacy.dailyPlans[localDateKey(now)].activeSession;

    expect(restoreActiveStudySession(legacy, now)).toBeNull();
    const upgraded = ensureDailyPlan(legacy, now);
    expect(upgraded.dailyPlans[localDateKey(now)].targetNewWords).toBe(20);
    expect(upgraded.dailyPlans[localDateKey(now)].wordIds).toEqual(planned.dailyPlans[localDateKey(now)].wordIds);
  });
});
