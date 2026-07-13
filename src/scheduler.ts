import type {
  AppData,
  Confidence,
  ContextExample,
  ContextRightsState,
  ContextUseScope,
  DailyPlan,
  GreQuestionMatch,
  GreQuestionMatchLocation,
  LearningState,
  QueueItem,
  Rating,
  WordEntry,
  WordSense,
} from "./types";

const DAY_MS = 86_400_000;
const DEFAULT_DAILY_NEW_WORDS = 20;
const MIN_DAILY_NEW_WORDS = 1;
const MAX_DAILY_NEW_WORDS = 200;

const displayableExampleKinds = new Set<ContextExample["kind"]>(["dictionary", "gre_official", "screen_dialogue"]);
const reusableRights = new Set<ContextRightsState>(["open_reuse", "project_owned", "permission_granted"]);
const privatelyControlledRights = new Set<ContextRightsState>(["permission_granted", "private_user_held"]);

function normalizedTokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
}

function tokenMatchesHeadword(token: string, headword: string): boolean {
  if (token === headword) return true;
  const suffixes = ["s", "es", "ed", "ing", "ly", "er", "est", "ness", "ment", "tion", "al"];
  if (token.startsWith(headword) && suffixes.includes(token.slice(headword.length))) return true;
  if (headword.endsWith("e") && token.startsWith(headword.slice(0, -1)) && ["ing", "ed"].includes(token.slice(headword.length - 1))) return true;
  if (headword.endsWith("y") && token.startsWith(headword.slice(0, -1)) && ["ies", "ied"].includes(token.slice(headword.length - 1))) return true;
  const final = headword.at(-1);
  if (final && token.startsWith(`${headword}${final}`) && ["ed", "ing"].includes(token.slice(headword.length + 1))) return true;
  return false;
}

export function exampleContainsHeadword(example: ContextExample, headword: string): boolean {
  const normalized = headword.trim().toLowerCase();
  if (!normalized) return false;
  if (/[^a-z]/.test(normalized)) return example.text.toLowerCase().includes(normalized);
  return normalizedTokens(example.text).some((token) => tokenMatchesHeadword(token, normalized));
}

export function exampleAllowedIn(example: ContextExample, scope: ContextUseScope): boolean {
  if (!Array.isArray(example.allowedIn) || !example.allowedIn.includes(scope)) return false;
  if (!example.rightsState || example.rightsState === "unknown" || example.rightsState === "restricted") return false;

  if (scope === "public") {
    if (example.kind === "gre_official" || example.kind === "screen_dialogue") return false;
    return reusableRights.has(example.rightsState);
  }

  if (example.kind === "gre_official" || example.kind === "screen_dialogue") {
    return privatelyControlledRights.has(example.rightsState);
  }
  return reusableRights.has(example.rightsState) || example.rightsState === "private_user_held";
}

export function studyExamplesFor(word: WordEntry, sense: WordSense, scope: ContextUseScope = "private"): ContextExample[] {
  if (sense.alignmentState !== "verified") return [];
  return sense.examples.filter((example) => (
    displayableExampleKinds.has(example.kind)
    && exampleAllowedIn(example, scope)
    && example.reviewState !== "auto_candidate"
    && Boolean(example.text.trim() && example.sourceLabel.trim() && example.provenance.trim())
    && exampleContainsHeadword(example, word.normalizedHeadword)
  ));
}

function completeGreMatchLocation(location: GreQuestionMatchLocation): boolean {
  if (typeof location === "string") return Boolean(location.trim());
  if (!(["passageText", "questionText", "option"] as const).includes(location.field)) return false;
  if (!Number.isInteger(location.start) || !Number.isInteger(location.end)) return false;
  if (location.start < 0 || location.end <= location.start) return false;
  return location.field !== "option" || Boolean(location.optionLabel?.trim());
}

export function isDisplayableGreQuestionMatchState(value: unknown): value is GreQuestionMatch["senseMatchState"] {
  return value === "confirmed_sense" || value === "word_form_only";
}

function isPrivateLocalQuestionMatch(match: GreQuestionMatch): boolean {
  const sourceFile = match.sourceFile?.trim();
  return Boolean(sourceFile)
    && !/^(?:https?|ftp|data|blob):/i.test(sourceFile)
    && !sourceFile.startsWith("//");
}

function isCompleteGreQuestionMatch(match: GreQuestionMatch): boolean {
  const hasStrings = [
    match.id,
    match.sourceLabel,
    match.sourceFile,
    match.locator,
    match.questionType,
    match.questionText,
    match.matchedSurface,
    match.reviewNote,
  ].every((value) => typeof value === "string" && Boolean(value.trim()));
  if (!hasStrings || !isPrivateLocalQuestionMatch(match)) return false;
  if (!Number.isInteger(match.pageStart) || match.pageStart < 1) return false;
  if (!Number.isInteger(match.pageEnd) || match.pageEnd < match.pageStart) return false;
  if (!isDisplayableGreQuestionMatchState(match.senseMatchState)) return false;
  if (!Array.isArray(match.options)) return false;
  if (match.questionType !== "reading_sentence_selection" && match.options.length < 2) return false;
  if (!match.options.every((option) => Boolean(option.label?.trim()) && Boolean(option.text?.trim()))) return false;
  if (!Array.isArray(match.matchLocations) || match.matchLocations.length === 0) return false;
  if (!match.matchLocations.every(completeGreMatchLocation)) return false;
  if (match.answerValues !== undefined && (
    !Array.isArray(match.answerValues)
    || match.answerValues.length === 0
    || !match.answerValues.every((value) => Boolean(value.trim()))
  )) return false;
  return match.passageText === undefined || Boolean(match.passageText.trim());
}

/**
 * Returns displayable local question evidence without affecting study readiness.
 * Exact sense matches are shown before word-form-only candidates.
 */
export function greQuestionMatchesFor(sense: WordSense): GreQuestionMatch[] {
  return (sense.greQuestionMatches ?? [])
    .filter(isCompleteGreQuestionMatch)
    .sort((left, right) => (
      Number(right.senseMatchState === "confirmed_sense")
      - Number(left.senseMatchState === "confirmed_sense")
    ));
}

export function hasTrustedPronunciation(word: WordEntry): boolean {
  return word.pronunciations.some((item) => (
    Boolean(item.ipa.trim())
    && (
      (item.quality === "dictionary_ipa" && item.reviewState === "source_verified")
      || (item.quality === "editor_reviewed" && item.reviewState === "editor_reviewed")
    )
  ));
}

function partOfSpeechFamily(value: string): "n" | "v" | "adj" | "adv" | "" {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("n")) return "n";
  if (normalized.startsWith("v")) return "v";
  if (normalized.startsWith("adj") || normalized === "a." || normalized === "a") return "adj";
  if (normalized.startsWith("adv") || normalized === "r." || normalized === "r") return "adv";
  return "";
}

export function senseKeyPartOfSpeech(openSenseId: string | null): "n" | "v" | "adj" | "adv" | "" {
  const code = openSenseId?.match(/%([1-5]):/)?.[1];
  if (code === "1") return "n";
  if (code === "2") return "v";
  if (code === "3" || code === "5") return "adj";
  if (code === "4") return "adv";
  return "";
}

export function sensePartOfSpeechMatchesKey(sense: WordSense): boolean {
  const expected = senseKeyPartOfSpeech(sense.openSenseId);
  return Boolean(expected && partOfSpeechFamily(sense.partOfSpeech) === expected);
}

export function hasTrustedSenseAlignment(sense: WordSense): boolean {
  if (sense.alignmentState !== "verified") return false;
  return /^Chinese Open Wordnet 1\.4 via CILI i\d+; exact: .+$/.test(sense.alignmentSource)
    || /^GRE Verbal Lab editorial review\b/.test(sense.alignmentSource);
}

function passesIntrinsicStudyGate(word: WordEntry, sense: WordSense): boolean {
  if (sense.studyReviewState === "excluded") return false;
  const relationKindChecked = (kind: "synonyms" | "antonyms") => {
    const state = sense.relationEvidence?.[kind]?.state;
    const values = sense.relations[kind];
    return (state === "verified_present" && values.length > 0)
      || (state === "source_checked_absent" && values.length === 0);
  };
  const hasCheckedLexicalEvidence = sense.relationState === "verified"
    && Boolean(sense.relationSource?.trim())
    && relationKindChecked("synonyms")
    && relationKindChecked("antonyms");
  return hasTrustedPronunciation(word)
    && hasTrustedSenseAlignment(sense)
    && sensePartOfSpeechMatchesKey(sense)
    && hasCheckedLexicalEvidence
    && studyExamplesFor(word, sense).length > 0;
}

export function isStudyReadySense(word: WordEntry, sense: WordSense): boolean {
  if (!passesIntrinsicStudyGate(word, sense)) return false;
  // Multiple source lists often phrase the same OEWN synset differently. Keep
  // those raw rows for provenance and library search, but schedule only the
  // first intrinsically valid row for a word+sense key.
  const canonical = word.senses.find((candidate) => (
    candidate.openSenseId === sense.openSenseId
    && passesIntrinsicStudyGate(word, candidate)
  ));
  return canonical?.id === sense.id;
}

export function isQuizTargetSense(word: WordEntry, sense: WordSense): boolean {
  return isStudyReadySense(word, sense) && sense.quizRole !== "distractor_only";
}

export function localDateKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function seedFrom(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFrom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function weightedSample(words: WordEntry[], count: number, random: () => number, longTail = false): WordEntry[] {
  const remaining = [...words];
  const selected: WordEntry[] = [];
  while (remaining.length && selected.length < count) {
    const weights = remaining.map((word) => {
      const base = longTail ? Math.max(1, 105 - word.frequencyProfile.priorityScore) : Math.max(1, word.frequencyProfile.priorityScore + 5);
      return base + word.initialLapses * 8;
    });
    const total = weights.reduce((sum, value) => sum + value, 0);
    let cursor = random() * total;
    let selectedIndex = weights.length - 1;
    for (let index = 0; index < weights.length; index += 1) {
      cursor -= weights[index];
      if (cursor <= 0) { selectedIndex = index; break; }
    }
    selected.push(remaining.splice(selectedIndex, 1)[0]);
  }
  return selected;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function normalizedDailyNewWords(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DAILY_NEW_WORDS;
  return Math.min(MAX_DAILY_NEW_WORDS, Math.max(MIN_DAILY_NEW_WORDS, Math.floor(value)));
}

function legacyNewWordCompletionsForDate(data: AppData, date: string): string[] {
  const primaryWordBySenseId = new Map(data.words.flatMap((word) => {
    const sense = word.senses[0];
    return sense && isQuizTargetSense(word, sense) ? [[sense.id, word] as const] : [];
  }));
  const reviewEventsToday = new Map<string, number>();
  for (const event of data.reviewEvents) {
    if (event.kind !== "review" || !primaryWordBySenseId.has(event.senseId)) continue;
    const reviewedAt = new Date(event.reviewedAt);
    if (!Number.isFinite(reviewedAt.getTime()) || localDateKey(reviewedAt) !== date) continue;
    reviewEventsToday.set(event.senseId, (reviewEventsToday.get(event.senseId) ?? 0) + 1);
  }
  const completed = new Set<string>();
  for (const [senseId, eventCount] of reviewEventsToday) {
    const reviewCount = data.learning[senseId]?.reviewCount ?? 0;
    // Older releases did not persist continuation sessions. If every recorded
    // review for a sense happened today, treat that first encounter as today's
    // new-word completion; an older sense has a larger lifetime review count.
    if (reviewCount > 0 && reviewCount <= eventCount) completed.add(primaryWordBySenseId.get(senseId)!.id);
  }
  return data.words.flatMap((word) => completed.has(word.id) ? [word.id] : []);
}

export function createDailyPlan(data: AppData, now = new Date()): DailyPlan {
  const date = localDateKey(now);
  const targetNewWords = normalizedDailyNewWords(data.settings.dailyNewWords);
  const existing = data.dailyPlans[date];
  if (
    existing?.catalogVersion === data.catalogVersion
    && existing.targetNewWords === targetNewWords
  ) return existing;
  const wordsById = new Map(data.words.map((word) => [word.id, word]));
  const compatibleExisting = existing?.catalogVersion === data.catalogVersion ? existing : undefined;
  const completedWordIds = [...new Set([
    ...(compatibleExisting?.wordIds ?? []).filter((wordId) => {
      const sense = wordsById.get(wordId)?.senses[0];
      return Boolean(sense && (data.learning[sense.id]?.reviewCount ?? 0) > 0);
    }),
    ...legacyNewWordCompletionsForDate(data, date),
  ])];
  const remainingTarget = Math.max(0, targetNewWords - completedWordIds.length);
  const completedSet = new Set(completedWordIds);
  const retainedPendingWordIds = [...new Set((compatibleExisting?.wordIds ?? []).filter((wordId) => {
    if (completedSet.has(wordId)) return false;
    const word = wordsById.get(wordId);
    const sense = word?.senses[0];
    return Boolean(
      word
      && sense
      && isQuizTargetSense(word, sense)
      && (data.learning[sense.id]?.reviewCount ?? 0) === 0
    );
  }))].slice(0, remainingTarget);
  const retainedSet = new Set([...completedWordIds, ...retainedPendingWordIds]);
  const seed = seedFrom(`${date}|${data.catalogVersion}|${targetNewWords}|${completedWordIds.join(",")}`);
  const random = randomFrom(seed);
  const unseen = data.words.filter((word) => (
    Boolean(word.senses[0] && isQuizTargetSense(word, word.senses[0]))
    && word.senses.every((sense) => (data.learning[sense.id]?.reviewCount ?? 0) === 0)
    && !retainedSet.has(word.id)
  ));
  const focusPool = unseen.filter((word) => word.frequencyProfile.tier === "focus");
  const longTailPool = unseen.filter((word) => word.frequencyProfile.tier === "long-tail" || word.frequencyProfile.tier === "unranked");
  const targetTotal = Math.min(
    Math.max(0, remainingTarget - retainedPendingWordIds.length),
    unseen.length,
  );
  const retainedFocusCount = retainedPendingWordIds.filter((wordId) => wordsById.get(wordId)?.frequencyProfile.tier === "focus").length;
  const desiredFocusCount = Math.round(remainingTarget * 0.7);
  const targetFocus = Math.min(Math.max(0, desiredFocusCount - retainedFocusCount), targetTotal, focusPool.length);
  const targetLongTail = Math.min(targetTotal - targetFocus, longTailPool.length);
  const focus = weightedSample(focusPool, targetFocus, random);
  const longTail = weightedSample(longTailPool, targetLongTail, random, true);
  const selectedIds = new Set([...focus, ...longTail].map((word) => word.id));
  const shortfall = targetTotal - selectedIds.size;
  const fallback = weightedSample(unseen.filter((word) => !selectedIds.has(word.id)), shortfall, random);
  const selected = shuffle([...focus, ...longTail, ...fallback], random);
  const retainedWordIds = [...new Set([
    ...(compatibleExisting?.wordIds ?? []).filter((wordId) => retainedSet.has(wordId)),
    ...completedWordIds,
  ])];
  const wordIds = [...retainedWordIds, ...selected.map((word) => word.id)];
  return {
    date,
    catalogVersion: data.catalogVersion,
    targetNewWords,
    seed,
    wordIds,
    focusCount: wordIds.filter((wordId) => wordsById.get(wordId)?.frequencyProfile.tier === "focus").length,
    longTailCount: wordIds.filter((wordId) => wordsById.get(wordId)?.frequencyProfile.tier !== "focus").length,
    generatedAt: now.toISOString(),
  };
}

export function ensureDailyPlan(data: AppData, now = new Date()): AppData {
  const plan = createDailyPlan(data, now);
  const existing = data.dailyPlans[plan.date];
  if (
    existing?.catalogVersion === data.catalogVersion
    && existing.targetNewWords === plan.targetNewWords
  ) return data;
  return { ...data, dailyPlans: { ...data.dailyPlans, [plan.date]: plan } };
}

export function createLearningState(sense: WordSense, initialLapses = 0, now = new Date()): LearningState {
  return {
    senseId: sense.id,
    reviewCount: 0,
    lapseCount: initialLapses,
    stabilityDays: 0.35,
    difficulty: initialLapses > 0 ? 6.5 : 5,
    definitionMastery: 0,
    relationshipMastery: 0,
    contextMastery: 0,
    lastReviewedAt: null,
    nextReviewAt: now.toISOString(),
    lastRating: null,
    lastConfidence: null,
    lastResponseTimeMs: null,
    scheduleReason: initialLapses > 0 ? "原词表记录过遗忘，优先安排首次复习。" : "尚未学习，加入新词队列。",
  };
}

export function ensureLearningStates(words: WordEntry[], current: Record<string, LearningState>): Record<string, LearningState> {
  const next = { ...current };
  for (const word of words) {
    for (const sense of word.senses) {
      next[sense.id] ??= createLearningState(sense, word.initialLapses);
    }
  }
  return next;
}

function queueReason(learning: LearningState, now: Date): string {
  if (learning.reviewCount === 0) return learning.scheduleReason;
  const overdueDays = Math.max(0, Math.floor((now.getTime() - new Date(learning.nextReviewAt).getTime()) / DAY_MS));
  if (learning.lapseCount > 1) return `曾遗忘 ${learning.lapseCount} 次，且已到复习时间。`;
  if (overdueDays > 0) return `已逾期 ${overdueDays} 天，优先恢复记忆。`;
  return "已到计划复习时间。";
}

export function buildDailyQueue(data: AppData, now = new Date()): QueueItem[] {
  const due: QueueItem[] = [];
  const nowMs = now.getTime();

  for (const word of data.words) {
    for (const sense of word.senses) {
      const learning = data.learning[sense.id] ?? createLearningState(sense, word.initialLapses, now);
      const item: QueueItem = { word, sense, learning, reason: queueReason(learning, now), isNew: learning.reviewCount === 0 };
      if (learning.reviewCount > 0 && isQuizTargetSense(word, sense) && new Date(learning.nextReviewAt).getTime() <= nowMs) due.push(item);
    }
  }

  due.sort((a, b) => {
    const lapseDifference = b.learning.lapseCount - a.learning.lapseCount;
    if (lapseDifference !== 0) return lapseDifference;
    return new Date(a.learning.nextReviewAt).getTime() - new Date(b.learning.nextReviewAt).getTime();
  });
  const plan = createDailyPlan(data, now);
  const wordsById = new Map(data.words.map((word) => [word.id, word]));
  const selectedFresh = plan.wordIds.flatMap((wordId) => {
    const word = wordsById.get(wordId);
    if (!word) return [];
    const sense = word.senses[0];
    if (!sense) return [];
    const learning = data.learning[sense.id] ?? createLearningState(sense, word.initialLapses, now);
    if (learning.reviewCount > 0) return [];
    const tierReason = word.frequencyProfile.tier === "focus"
      ? `重点层：学习优先级第 ${word.frequencyProfile.rank} 位，本地材料出现 ${word.frequencyProfile.localMaterialCount} 次。`
      : `长尾探索：按 30% 配额加入，避免只认识常见词。`;
    return [{ word, sense, learning, reason: tierReason, isNew: true } satisfies QueueItem];
  });
  const selectedDue = due.slice(0, data.settings.dailyReviewLimit);
  const mixed: QueueItem[] = [];
  while (selectedDue.length || selectedFresh.length) {
    if (selectedDue.length) mixed.push(selectedDue.shift()!);
    if (selectedFresh.length) mixed.push(selectedFresh.shift()!);
  }
  return mixed;
}

export function applyRating(
  previous: LearningState,
  rating: Rating,
  confidence: Confidence,
  responseTimeMs: number,
  examDate: string,
  now = new Date(),
): LearningState {
  const examTime = new Date(`${examDate}T12:00:00`).getTime();
  const daysToExam = Number.isFinite(examTime) ? Math.max(1, (examTime - now.getTime()) / DAY_MS) : 90;
  const urgency = daysToExam <= 30 ? 0.65 : daysToExam <= 60 ? 0.8 : 1;
  const confidenceFactor = confidence === 1 ? 0.8 : confidence === 3 ? 1.12 : 1;
  let stability = Math.max(0.35, previous.stabilityDays);
  let intervalDays = 0;
  let lapseCount = previous.lapseCount;
  let difficulty = previous.difficulty;
  let masteryDelta = 0;
  let reason = "";

  if (rating === "again") {
    stability = Math.max(0.2, stability * 0.45);
    intervalDays = 10 / 1_440;
    lapseCount += 1;
    difficulty = Math.min(10, difficulty + 0.8);
    masteryDelta = -18;
    reason = "未能回忆；10 分钟后重新出现，并提高错题优先级。";
  } else if (rating === "hard") {
    stability = Math.max(1, stability * 1.35);
    intervalDays = Math.max(1, stability * confidenceFactor * urgency);
    difficulty = Math.min(10, difficulty + 0.25);
    masteryDelta = 7;
    reason = "回忆困难；缩短间隔以避免形成虚假熟悉感。";
  } else if (rating === "good") {
    stability = Math.max(1.5, stability * 2.45);
    intervalDays = Math.max(1, stability * confidenceFactor * urgency);
    difficulty = Math.max(1, difficulty - 0.2);
    masteryDelta = 14;
    reason = daysToExam <= 60 ? "正确回忆；因临近考试适度压缩间隔。" : "正确回忆；按稳定度延长复习间隔。";
  } else {
    stability = Math.max(3, stability * 3.9);
    intervalDays = Math.max(3, stability * confidenceFactor * urgency);
    difficulty = Math.max(1, difficulty - 0.55);
    masteryDelta = 22;
    reason = "快速且确定地回忆；显著延长间隔。";
  }

  return {
    ...previous,
    reviewCount: previous.reviewCount + 1,
    lapseCount,
    stabilityDays: Number(stability.toFixed(2)),
    difficulty: Number(difficulty.toFixed(2)),
    definitionMastery: Math.max(0, Math.min(100, previous.definitionMastery + masteryDelta)),
    lastReviewedAt: now.toISOString(),
    nextReviewAt: new Date(now.getTime() + intervalDays * DAY_MS).toISOString(),
    lastRating: rating,
    lastConfidence: confidence,
    lastResponseTimeMs: responseTimeMs,
    scheduleReason: reason,
  };
}

export function findSense(data: AppData, senseId: string): { word: WordEntry; sense: WordSense } | null {
  for (const word of data.words) {
    const sense = word.senses.find((candidate) => candidate.id === senseId);
    if (sense) return { word, sense };
  }
  return null;
}
