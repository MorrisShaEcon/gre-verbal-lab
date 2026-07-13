import { createDailyPlan, createLearningState, isQuizTargetSense } from "./scheduler";
import type { ActiveStudySession, AppData, FrequencyTier, QueueItem, WordEntry, WordSense } from "./types";

export const DEFAULT_DAILY_NEW_WORD_GOAL = 20;
export const MIN_DAILY_NEW_WORD_GOAL = 1;
export const MAX_DAILY_NEW_WORD_GOAL = 200;

export interface PrimaryStudyTarget {
  word: WordEntry;
  sense: WordSense;
  tier: "focus" | "long-tail";
}

export interface RemainingTargetOptions {
  /** Word ids already placed in an in-memory session or an extra batch. */
  scheduledWordIds?: Iterable<string>;
  /** Sense ids already placed in an in-memory session or an extra batch. */
  scheduledSenseIds?: Iterable<string>;
  /** Stored daily plans count as already scheduled by default. */
  includeStoredPlans?: boolean;
}

export interface StudyGoalForecast {
  dailyNewWordGoal: number;
  remainingTargetCount: number;
  studyDays: number;
  startDate: string;
  estimatedCompletionDate: string;
}

export interface AdditionalBatchOptions extends RemainingTargetOptions {
  /** Defaults to data.settings.dailyNewWords, then to 20 if invalid. */
  dailyNewWordGoal?: number;
  /** Defaults to the normalized daily target and is independently capped at 200. */
  requestedCount?: number;
  /** A stable caller-provided key may be used to reproduce a particular batch. */
  seedKey?: string;
}

export interface AdditionalNewWordBatch {
  requestedCount: number;
  selectedCount: number;
  remainingBefore: number;
  remainingAfter: number;
  focusCount: number;
  longTailCount: number;
  wordIds: string[];
  senseIds: string[];
  targets: PrimaryStudyTarget[];
  seed: number;
}

export interface ActiveStudySessionProgress {
  sessionId: string;
  queueSenseIds: string[];
  nextIndex: number;
  now?: Date;
}

export interface RestoredStudySession {
  session: ActiveStudySession;
  queue: QueueItem[];
}

/**
 * Converts editable numeric input into a safe whole-number daily goal.
 * Invalid input uses the supplied fallback; valid input is clamped to 1-200.
 */
export function normalizeDailyNewWordGoal(
  value: number | null | undefined,
  fallback = DEFAULT_DAILY_NEW_WORD_GOAL,
): number {
  const safeFallback = Number.isFinite(fallback)
    ? Math.min(MAX_DAILY_NEW_WORD_GOAL, Math.max(MIN_DAILY_NEW_WORD_GOAL, Math.floor(fallback)))
    : DEFAULT_DAILY_NEW_WORD_GOAL;
  if (!Number.isFinite(value)) return safeFallback;
  return Math.min(MAX_DAILY_NEW_WORD_GOAL, Math.max(MIN_DAILY_NEW_WORD_GOAL, Math.floor(value!)));
}

function normalizedTier(tier: FrequencyTier): "focus" | "long-tail" {
  return tier === "focus" ? "focus" : "long-tail";
}

function primaryQuizTarget(word: WordEntry): WordSense | null {
  const sense = word.senses[0];
  return sense && isQuizTargetSense(word, sense) ? sense : null;
}

function storedPlanWordIds(data: AppData): string[] {
  return Object.values(data.dailyPlans).flatMap((plan) => plan.wordIds);
}

/**
 * Returns unseen, quiz-ready primary senses that have not already been queued.
 * The function does not mutate AppData or create a daily plan.
 */
export function collectRemainingPrimaryTargets(
  data: AppData,
  options: RemainingTargetOptions = {},
): PrimaryStudyTarget[] {
  const excludedWordIds = new Set(options.scheduledWordIds ?? []);
  if (options.includeStoredPlans !== false) {
    for (const wordId of storedPlanWordIds(data)) excludedWordIds.add(wordId);
  }
  const excludedSenseIds = new Set(options.scheduledSenseIds ?? []);

  return data.words.flatMap((word) => {
    const sense = primaryQuizTarget(word);
    if (!sense) return [];
    if (excludedWordIds.has(word.id) || excludedSenseIds.has(sense.id)) return [];
    if ((data.learning[sense.id]?.reviewCount ?? 0) > 0) return [];
    return [{ word, sense, tier: normalizedTier(word.frequencyProfile.tier) } satisfies PrimaryStudyTarget];
  });
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addCalendarDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setHours(12, 0, 0, 0);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Forecasts a continuous study run in which today is day one. Consequently,
 * one day's work has an estimated completion date equal to the start date.
 */
export function forecastStudyGoal(
  remainingTargetCount: number,
  dailyNewWordGoal: number | null | undefined,
  startDate = new Date(),
): StudyGoalForecast {
  const goal = normalizeDailyNewWordGoal(dailyNewWordGoal);
  const remaining = Number.isFinite(remainingTargetCount)
    ? Math.max(0, Math.floor(remainingTargetCount))
    : 0;
  const studyDays = Math.ceil(remaining / goal);
  const completionOffset = Math.max(0, studyDays - 1);
  return {
    dailyNewWordGoal: goal,
    remainingTargetCount: remaining,
    studyDays,
    startDate: localDateKey(startDate),
    estimatedCompletionDate: localDateKey(addCalendarDays(startDate, completionOffset)),
  };
}

export function forecastRemainingPrimaryTargets(
  data: AppData,
  options: RemainingTargetOptions & { dailyNewWordGoal?: number; startDate?: Date } = {},
): StudyGoalForecast {
  const remaining = collectRemainingPrimaryTargets(data, options).length;
  return forecastStudyGoal(
    remaining,
    options.dailyNewWordGoal ?? data.settings.dailyNewWords,
    options.startDate,
  );
}

function seedFrom(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFrom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function weightedSample(
  candidates: PrimaryStudyTarget[],
  count: number,
  random: () => number,
  longTail = false,
): PrimaryStudyTarget[] {
  const remaining = [...candidates];
  const selected: PrimaryStudyTarget[] = [];
  while (remaining.length && selected.length < count) {
    const weights = remaining.map(({ word }) => {
      const priority = word.frequencyProfile.priorityScore;
      const base = longTail ? Math.max(1, 105 - priority) : Math.max(1, priority + 5);
      return base + word.initialLapses * 8;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = random() * total;
    let selectedIndex = weights.length - 1;
    for (let index = 0; index < weights.length; index += 1) {
      cursor -= weights[index];
      if (cursor <= 0) {
        selectedIndex = index;
        break;
      }
    }
    selected.push(remaining.splice(selectedIndex, 1)[0]);
  }
  return selected;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

/**
 * Selects another new-word batch after the current session is complete.
 * Calling it again with the previous batch ids in scheduledWordIds yields a
 * disjoint next batch, while retaining the 70/30 focus/long-tail target where
 * pool availability permits.
 */
export function selectAdditionalNewWordBatch(
  data: AppData,
  options: AdditionalBatchOptions = {},
): AdditionalNewWordBatch {
  const dailyGoal = normalizeDailyNewWordGoal(
    options.dailyNewWordGoal ?? data.settings.dailyNewWords,
  );
  const requestedCount = normalizeDailyNewWordGoal(options.requestedCount, dailyGoal);
  const candidates = collectRemainingPrimaryTargets(data, options);
  const targetTotal = Math.min(requestedCount, candidates.length);
  const scheduledKey = [...(options.scheduledWordIds ?? [])].sort().join(",");
  const seed = seedFrom([
    data.catalogVersion,
    options.seedKey ?? "additional",
    requestedCount,
    scheduledKey,
  ].join("|"));
  const random = randomFrom(seed);
  const focusPool = candidates.filter(({ tier }) => tier === "focus");
  const longTailPool = candidates.filter(({ tier }) => tier === "long-tail");
  const targetFocusCount = Math.min(Math.round(targetTotal * 0.7), focusPool.length);
  const targetLongTailCount = Math.min(targetTotal - targetFocusCount, longTailPool.length);
  const focus = weightedSample(focusPool, targetFocusCount, random);
  const longTail = weightedSample(longTailPool, targetLongTailCount, random, true);
  const selectedIds = new Set([...focus, ...longTail].map(({ word }) => word.id));
  const shortfall = targetTotal - selectedIds.size;
  const fallback = weightedSample(
    candidates.filter(({ word }) => !selectedIds.has(word.id)),
    shortfall,
    random,
  );
  const targets = shuffle([...focus, ...longTail, ...fallback], random);

  return {
    requestedCount,
    selectedCount: targets.length,
    remainingBefore: candidates.length,
    remainingAfter: candidates.length - targets.length,
    focusCount: targets.filter(({ tier }) => tier === "focus").length,
    longTailCount: targets.filter(({ tier }) => tier === "long-tail").length,
    wordIds: targets.map(({ word }) => word.id),
    senseIds: targets.map(({ sense }) => sense.id),
    targets,
    seed,
  };
}

/**
 * Adds a continuation batch to today's plan and records its exact queue in the
 * same AppData update. Persisting that single update makes the operation
 * atomic: a reload can never see the scheduled words without their session,
 * or the session without the scheduled words.
 */
export function persistAdditionalNewWordBatch(
  data: AppData,
  batch: AdditionalNewWordBatch,
  now = new Date(),
): AppData {
  if (!batch.senseIds.length || batch.senseIds.length !== batch.wordIds.length) return data;
  const plan = createDailyPlan(data, now);
  const wordsById = new Map(data.words.map((word) => [word.id, word]));
  const scheduledWordIds = new Set(plan.wordIds);
  const selected = batch.wordIds.flatMap((wordId, index) => {
    const word = wordsById.get(wordId);
    const sense = word?.senses[0];
    if (
      !word
      || !sense
      || sense.id !== batch.senseIds[index]
      || !isQuizTargetSense(word, sense)
      || (data.learning[sense.id]?.reviewCount ?? 0) > 0
      || scheduledWordIds.has(word.id)
    ) return [];
    scheduledWordIds.add(word.id);
    return [{ word, sense }];
  });
  if (!selected.length) return data;

  const createdAt = now.toISOString();
  const queueSenseIds = selected.map(({ sense }) => sense.id);
  const session: ActiveStudySession = {
    id: `additional-${plan.date}-${batch.seed.toString(36)}`,
    kind: "additional_new_words",
    date: plan.date,
    catalogVersion: data.catalogVersion,
    queueSenseIds,
    nextIndex: 0,
    createdAt,
    updatedAt: createdAt,
  };
  const wordIds = [...plan.wordIds, ...selected.map(({ word }) => word.id)];
  const nextPlan = {
    ...plan,
    wordIds,
    focusCount: wordIds.filter((wordId) => wordsById.get(wordId)?.frequencyProfile.tier === "focus").length,
    longTailCount: wordIds.filter((wordId) => wordsById.get(wordId)?.frequencyProfile.tier !== "focus").length,
    activeSession: session,
  };
  return {
    ...data,
    dailyPlans: { ...data.dailyPlans, [plan.date]: nextPlan },
  };
}

function validActiveStudySession(data: AppData, value: ActiveStudySession | undefined, now: Date): value is ActiveStudySession {
  if (!value) return false;
  const plan = data.dailyPlans[value.date];
  if (
    !plan
    || plan.date !== value.date
    || plan.activeSession?.id !== value.id
    || value.kind !== "additional_new_words"
    || !value.id?.trim()
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)
    || value.date > localDateKey(now)
    || value.catalogVersion !== data.catalogVersion
    || !Array.isArray(value.queueSenseIds)
    || value.queueSenseIds.length === 0
    || !value.queueSenseIds.every((senseId) => typeof senseId === "string" && Boolean(senseId.trim()))
    || !Number.isInteger(value.nextIndex)
    || value.nextIndex < 0
    || value.nextIndex >= value.queueSenseIds.length
  ) return false;
  const plannedWordIds = new Set(plan.wordIds);
  const primaryWordIdBySenseId = new Map(data.words.flatMap((word) => {
    const sense = word.senses[0];
    return sense && isQuizTargetSense(word, sense) ? [[sense.id, word.id] as const] : [];
  }));
  return value.queueSenseIds.every((senseId) => {
    const wordId = primaryWordIdBySenseId.get(senseId);
    return Boolean(wordId && plannedWordIds.has(wordId));
  });
}

/** Returns the full saved queue and cursor so the UI can resume in-place. */
export function restoreActiveStudySession(data: AppData, now = new Date()): RestoredStudySession | null {
  const session = Object.values(data.dailyPlans)
    .map((plan) => plan.activeSession)
    .filter((value): value is ActiveStudySession => validActiveStudySession(data, value, now))
    .sort((left, right) => (
      right.updatedAt.localeCompare(left.updatedAt)
      || right.date.localeCompare(left.date)
    ))[0];
  if (!session) return null;
  const targetsBySenseId = new Map(data.words.flatMap((word) => (
    word.senses.map((sense) => [sense.id, { word, sense }] as const)
  )));
  const queue = session.queueSenseIds.map((senseId) => {
    const target = targetsBySenseId.get(senseId)!;
    const learning = data.learning[senseId] ?? createLearningState(target.sense, target.word.initialLapses, now);
    return {
      ...target,
      learning,
      isNew: learning.reviewCount === 0,
      reason: learning.reviewCount > 0
        ? learning.scheduleReason
        : target.word.frequencyProfile.tier === "focus"
          ? `继续学习 · 重点层：优先级第 ${target.word.frequencyProfile.rank} 位。`
          : "继续学习 · 长尾层：按 30% 配额加入，防止只熟悉高频词。",
    } satisfies QueueItem;
  });
  return { session, queue };
}

/**
 * Advances the saved cursor together with any retry appended to the queue.
 * Completion removes only the active session; its words stay in today's plan.
 */
export function updateActiveStudySessionProgress(
  data: AppData,
  progress: ActiveStudySessionProgress,
): AppData {
  const now = progress.now ?? new Date();
  const entry = Object.entries(data.dailyPlans).find(([date, candidate]) => (
    candidate.activeSession?.id === progress.sessionId
    && candidate.activeSession.date === date
  ));
  if (!entry) return data;
  const [date, plan] = entry;
  const session = plan?.activeSession;
  if (!session || session.catalogVersion !== data.catalogVersion) return data;
  const queueSenseIds = progress.queueSenseIds.filter((senseId) => typeof senseId === "string" && Boolean(senseId.trim()));
  const nextIndex = Math.max(0, Math.floor(progress.nextIndex));
  if (!queueSenseIds.length || nextIndex >= queueSenseIds.length) {
    const { activeSession: _completed, ...completedPlan } = plan;
    return { ...data, dailyPlans: { ...data.dailyPlans, [date]: completedPlan } };
  }
  const activeSession: ActiveStudySession = {
    ...session,
    queueSenseIds,
    nextIndex,
    updatedAt: now.toISOString(),
  };
  return {
    ...data,
    dailyPlans: { ...data.dailyPlans, [date]: { ...plan, activeSession } },
  };
}
