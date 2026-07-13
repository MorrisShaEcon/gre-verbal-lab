import { applyRating, isQuizTargetSense, isStudyReadySense } from "./scheduler";
import { stableId, type Confidence, type LearningState, type Rating, type WordEntry, type WordSense } from "./types";

export interface DefinitionQuizOption {
  id: string;
  text: string;
  senseId: string;
}

export interface DefinitionQuizQuestion {
  id: string;
  kind: "definition_mcq";
  wordId: string;
  senseId: string;
  headword: string;
  partOfSpeech: string;
  options: DefinitionQuizOption[];
  correctOptionId: string;
  distractorSenseIds: string[];
}

export type QuizMasteryDecision = "not_mastered" | "learning" | "remembered" | "fluent";
export type QuizResponseBand = "incorrect" | "first_exposure" | "effortful" | "recalled" | "fluent" | "timing_unscored";

export interface DefinitionQuizEvaluation {
  isCorrect: boolean;
  selectedOptionId: string;
  correctOptionId: string;
  rating: Rating;
  inferredConfidence: Confidence;
  responseBand: QuizResponseBand;
  masteryDecision: QuizMasteryDecision;
  feedbackTitle: string;
  feedbackDetail: string;
}

export interface ApplyDefinitionQuizAnswerResult {
  evaluation: DefinitionQuizEvaluation;
  learning: LearningState;
}

export interface DefinitionQuestionInput {
  word: WordEntry;
  sense: WordSense;
  catalogWords: WordEntry[];
  /** Stable per attempt. A different value rotates distractors and answer position. */
  attemptSeed: string | number;
  /** Previously chosen wrong senses for this learner. */
  preferredDistractorSenseIds?: string[];
}

export interface ApplyDefinitionQuizAnswerInput {
  question: DefinitionQuizQuestion;
  selectedOptionId: string;
  previousLearning: LearningState;
  responseTimeMs: number;
  examDate: string;
  now?: Date;
  /** Disable time-based penalties for screen-reader, motor, or reading accommodations. */
  useResponseTime?: boolean;
}

interface Candidate {
  word: WordEntry;
  sense: WordSense;
  score: number;
  samePartOfSpeech: boolean;
}

const normalizeText = (value: string): string => value
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[\s·•.,，。;；:：!?！？'"“”‘’()（）\[\]【】/\\\-]+/g, "")
  .trim();

const normalizeHeadword = (value: string): string => value
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[^a-z]/g, "");

function tokensForDefinition(value: string): Set<string> {
  const normalized = value.normalize("NFKC").toLowerCase();
  const tokens = new Set(normalized.match(/[a-z]{2,}|[\u3400-\u9fff]/g) ?? []);
  const han = (normalized.match(/[\u3400-\u9fff]/g) ?? []).join("");
  for (let index = 0; index < han.length - 1; index += 1) tokens.add(han.slice(index, index + 2));
  return tokens;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function hasOppositePolarity(longer: string, shorter: string): boolean {
  const index = longer.indexOf(shorter);
  if (index < 0) return false;
  const before = [...longer.slice(0, index)].at(-1) ?? "";
  return /[不无非未莫勿]/u.test(before) && !/^[不无非未莫勿]/u.test(shorter);
}

function longestCommonRun(left: string, right: string): number {
  const first = [...left];
  const second = [...right];
  let previous = new Uint16Array(second.length + 1);
  let longest = 0;
  for (let row = 1; row <= first.length; row += 1) {
    const current = new Uint16Array(second.length + 1);
    for (let column = 1; column <= second.length; column += 1) {
      if (first[row - 1] === second[column - 1]) {
        current[column] = previous[column - 1] + 1;
        longest = Math.max(longest, current[column]);
      }
    }
    previous = current;
  }
  return longest;
}

function hanCharacterOverlap(left: string, right: string): number {
  const ignored = new Set(["的", "地", "得", "很", "极", "为", "使", "对"]);
  const first = new Set([...left].filter((character) => /[\u3400-\u9fff]/u.test(character) && !ignored.has(character)));
  const second = new Set([...right].filter((character) => /[\u3400-\u9fff]/u.test(character) && !ignored.has(character)));
  if (!first.size || !second.size) return 0;
  let overlap = 0;
  for (const character of first) if (second.has(character)) overlap += 1;
  return overlap / Math.min(first.size, second.size);
}

export function definitionsAreTooClose(left: string, right: string): boolean {
  const first = normalizeText(left);
  const second = normalizeText(right);
  if (!first || !second) return false;
  if (first === second) return true;
  const [longer, shorter] = first.length >= second.length ? [first, second] : [second, first];
  if (shorter.length >= 2 && longer.includes(shorter) && !hasOppositePolarity(longer, shorter)) return true;
  const polarityDiffers = /[不无非未莫勿]/u.test(first) !== /[不无非未莫勿]/u.test(second);
  const sharedRun = longestCommonRun(first, second);
  if (!polarityDiffers && sharedRun >= 2 && sharedRun / Math.min(first.length, second.length) >= 0.5) return true;
  if (!polarityDiffers && hanCharacterOverlap(first, second) >= 0.75) return true;
  return jaccard(tokensForDefinition(left), tokensForDefinition(right)) >= 0.6;
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

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function relationSet(values: string[]): Set<string> {
  return new Set(values.map(normalizeHeadword).filter(Boolean));
}

export function definitionQuizPartOfSpeechFamily(value: string): string {
  const normalized = value.toLowerCase();
  if (/\b(adj|adjective)\b/.test(normalized)) return "adj";
  if (/\b(adv|adverb)\b/.test(normalized)) return "adv";
  if (/\b(v|verb|vt|vi)\b/.test(normalized)) return "verb";
  if (/\b(n|noun)\b/.test(normalized)) return "noun";
  return normalized.replace(/[^a-z]/g, "");
}

function alignmentConceptId(sense: WordSense): string {
  return sense.alignmentSource.match(/\bCILI\s+(i\d+)\b/i)?.[1]?.toLowerCase() ?? "";
}

export function definitionQuizConceptKeys(sense: WordSense): string[] {
  const openSenseId = sense.openSenseId?.trim().toLowerCase();
  const cili = alignmentConceptId(sense);
  return [openSenseId ? `sense:${openSenseId}` : "", cili ? `cili:${cili}` : ""].filter(Boolean);
}

function conceptsOverlap(left: WordSense, right: WordSense): boolean {
  const leftKeys = new Set(definitionQuizConceptKeys(left));
  return definitionQuizConceptKeys(right).some((key) => leftKeys.has(key));
}

export function areDeclaredDefinitionQuizSynonyms(
  leftWord: WordEntry,
  leftSense: WordSense,
  rightWord: WordEntry,
  rightSense: WordSense,
): boolean {
  const leftHeadword = normalizeHeadword(leftWord.headword);
  const rightHeadword = normalizeHeadword(rightWord.headword);
  return relationSet(leftSense.relations.synonyms).has(rightHeadword)
    || relationSet(rightSense.relations.synonyms).has(leftHeadword);
}

function explicitRelationRank(
  targetWord: WordEntry,
  targetSense: WordSense,
  candidateWord: WordEntry,
  candidateSense: WordSense,
): number {
  const targetHeadword = normalizeHeadword(targetWord.headword);
  const candidateHeadword = normalizeHeadword(candidateWord.headword);
  if ((targetSense.confusableSenseIds ?? []).includes(candidateSense.id)) return 6;
  if ((candidateSense.confusableSenseIds ?? []).includes(targetSense.id)) return 5;
  const targetConfusables = relationSet(targetSense.relations.confusables);
  const candidateConfusables = relationSet(candidateSense.relations.confusables);
  if (targetConfusables.has(candidateHeadword)) return 4;
  if (candidateConfusables.has(targetHeadword)) return 3;
  const targetAntonyms = relationSet(targetSense.relations.antonyms);
  const candidateAntonyms = relationSet(candidateSense.relations.antonyms);
  if (targetAntonyms.has(candidateHeadword)) return 2;
  if (candidateAntonyms.has(targetHeadword)) return 1;
  return 0;
}

export function hasExplicitDefinitionQuizRelation(
  targetWord: WordEntry,
  targetSense: WordSense,
  candidateWord: WordEntry,
  candidateSense: WordSense,
): boolean {
  return explicitRelationRank(targetWord, targetSense, candidateWord, candidateSense) > 0;
}

function rankCandidates(
  word: WordEntry,
  sense: WordSense,
  catalogWords: WordEntry[],
  seed: number,
  preferredDistractorSenseIds: string[] = [],
): Candidate[] {
  const targetHeadword = normalizeHeadword(word.headword);
  const synonyms = relationSet(sense.relations.synonyms);
  const targetDefinition = normalizeText(sense.definitionZh);
  const targetPartOfSpeech = definitionQuizPartOfSpeechFamily(sense.partOfSpeech);
  const personalConfusions = new Set(preferredDistractorSenseIds);
  const candidates: Candidate[] = [];

  for (const candidateWord of catalogWords) {
    const candidateHeadword = normalizeHeadword(candidateWord.headword);
    if (!candidateHeadword || candidateHeadword === targetHeadword || synonyms.has(candidateHeadword)) continue;
    for (const candidateSense of candidateWord.senses) {
      // A distractor is learning content, not filler. It must pass the complete
      // scheduling gate: trusted pronunciation, sense alignment, lexical
      // evidence, part of speech, and a rights-cleared aligned example.
      if (!isStudyReadySense(candidateWord, candidateSense)) continue;
      if (conceptsOverlap(sense, candidateSense)) continue;
      if (!candidateSense.definitionZh.trim()) continue;
      const candidateDefinition = normalizeText(candidateSense.definitionZh);
      if (!candidateDefinition || candidateDefinition === targetDefinition) continue;
      if (areDeclaredDefinitionQuizSynonyms(word, sense, candidateWord, candidateSense)) continue;
      // Near-identical meanings can create two defensible correct answers.
      if (definitionsAreTooClose(sense.definitionZh, candidateSense.definitionZh)) continue;
      if (
        sense.definitionEn.trim()
        && candidateSense.definitionEn.trim()
        && definitionsAreTooClose(sense.definitionEn, candidateSense.definitionEn)
      ) continue;

      const samePartOfSpeech = definitionQuizPartOfSpeechFamily(candidateSense.partOfSpeech) === targetPartOfSpeech;
      const relationRank = explicitRelationRank(word, sense, candidateWord, candidateSense);
      let score = relationRank * 1_000;
      if (personalConfusions.has(candidateSense.id)) score += 10_000;
      if (samePartOfSpeech) score += 120;
      if (candidateWord.frequencyProfile.tier === word.frequencyProfile.tier) score += 8;
      score += Math.max(0, 12 - Math.abs(candidateWord.frequencyProfile.rank - word.frequencyProfile.rank) / 100);
      // Stable jitter rotates equally plausible options without making a session flicker.
      score += (seedFrom(`${seed}|${candidateSense.id}`) % 10_000) / 10_000;
      // Spelling resemblance is deliberately not scored. Without a verified
      // confusable edge, a look-alike word has no stronger claim than another
      // formally ready same-POS meaning.
      candidates.push({
        word: candidateWord,
        sense: candidateSense,
        score,
        samePartOfSpeech,
      });
    }
  }
  return candidates.sort((left, right) => right.score - left.score);
}

function selectUniqueDistractors(candidates: Candidate[], count: number): Candidate[] {
  const selected: Candidate[] = [];
  const usedDefinitions = new Set<string>();
  const usedWords = new Set<string>();
  const usedConcepts = new Set<string>();

  for (const candidate of candidates) {
    const definition = normalizeText(candidate.sense.definitionZh);
    if (usedDefinitions.has(definition) || usedWords.has(candidate.word.id)) continue;
    const conceptKeys = definitionQuizConceptKeys(candidate.sense);
    if (conceptKeys.some((key) => usedConcepts.has(key))) continue;
    // Avoid distractors that are alternate lexicalizations or paraphrases of
    // one another; four options must represent four distinct concepts.
    if (selected.some((existing) => (
      areDeclaredDefinitionQuizSynonyms(existing.word, existing.sense, candidate.word, candidate.sense)
      || definitionsAreTooClose(existing.sense.definitionZh, candidate.sense.definitionZh)
      || (
        existing.sense.definitionEn.trim()
        && candidate.sense.definitionEn.trim()
        && definitionsAreTooClose(existing.sense.definitionEn, candidate.sense.definitionEn)
      )
    ))) continue;
    selected.push(candidate);
    usedDefinitions.add(definition);
    usedWords.add(candidate.word.id);
    for (const key of conceptKeys) usedConcepts.add(key);
    if (selected.length === count) break;
  }

  return selected;
}

function chooseDistractors(candidates: Candidate[], count: number): Candidate[] {
  // When three trustworthy same-POS choices exist, keep the complete option
  // set grammatically parallel. Explicit confusable/antonym edges still lead
  // the ranking inside that pool.
  const samePartOfSpeech = selectUniqueDistractors(
    candidates.filter((candidate) => candidate.samePartOfSpeech),
    count,
  );
  if (samePartOfSpeech.length === count) return samePartOfSpeech;

  const selected = selectUniqueDistractors(candidates, count);
  if (selected.length === count) return selected;

  throw new Error(`无法为该词义生成 ${count} 个不歧义的干扰项；请先补充可混淆词数据。`);
}

export function createDefinitionQuizQuestion(input: DefinitionQuestionInput): DefinitionQuizQuestion {
  const { word, sense, catalogWords, attemptSeed, preferredDistractorSenseIds = [] } = input;
  if (!isQuizTargetSense(word, sense)) {
    if (sense.quizRole === "distractor_only") throw new Error("该词义仅用于干扰项，不能作为题干。");
    throw new Error("目标词义未通过正式出题门槛。");
  }
  if (!sense.definitionZh.trim()) throw new Error("目标词义缺少中文释义，无法生成选择题。");
  const seed = seedFrom(`${word.id}|${sense.id}|${attemptSeed}`);
  const random = randomFrom(seed);
  const distractors = chooseDistractors(
    rankCandidates(word, sense, catalogWords, seed, preferredDistractorSenseIds),
    3,
  );
  const questionId = stableId("quiz", `${sense.id}|${attemptSeed}`);
  const correctOptionId = stableId("option", `${questionId}|${sense.id}`);
  const options = shuffle([
    { id: correctOptionId, text: sense.definitionZh.trim(), senseId: sense.id },
    ...distractors.map(({ sense: distractor }) => ({
      id: stableId("option", `${questionId}|${distractor.id}`),
      text: distractor.definitionZh.trim(),
      senseId: distractor.id,
    })),
  ], random);

  return {
    id: questionId,
    kind: "definition_mcq",
    wordId: word.id,
    senseId: sense.id,
    headword: word.headword,
    partOfSpeech: sense.partOfSpeech,
    options,
    correctOptionId,
    distractorSenseIds: distractors.map(({ sense: distractor }) => distractor.id),
  };
}

export function evaluateDefinitionQuizAnswer(
  question: DefinitionQuizQuestion,
  selectedOptionId: string,
  previousLearning: LearningState,
  responseTimeMs: number,
  useResponseTime = true,
): DefinitionQuizEvaluation {
  if (!question.options.some((option) => option.id === selectedOptionId)) throw new Error("所选答案不属于当前题目。");
  // Invalid telemetry must never turn into a falsely "instant" fluent answer.
  const normalizedResponseTimeMs = Number.isFinite(responseTimeMs) && responseTimeMs >= 0
    ? Math.max(300, responseTimeMs)
    : 10_001;
  const isCorrect = selectedOptionId === question.correctOptionId;
  let rating: Rating;
  let inferredConfidence: Confidence;
  let responseBand: QuizResponseBand;
  let masteryDecision: QuizMasteryDecision;
  let feedbackTitle: string;
  let feedbackDetail: string;

  if (!isCorrect) {
    rating = "again";
    inferredConfidence = 1;
    responseBand = "incorrect";
    masteryDecision = "not_mastered";
    feedbackTitle = "还没有记牢";
    feedbackDetail = "系统已记录这次混淆；本轮稍后会再次出现，并缩短下次复习间隔。";
  } else if (previousLearning.reviewCount === 0) {
    // A four-option first encounter has a 25% guess baseline, so one hit is evidence of learning, not mastery.
    rating = "hard";
    inferredConfidence = 2;
    responseBand = "first_exposure";
    masteryDecision = "learning";
    feedbackTitle = "第一次答对";
    feedbackDetail = "这说明你初步识别了词义，但还不能判定为掌握；系统会在较短间隔后复测。";
  } else if (
    previousLearning.lastRating === "again"
    || (previousLearning.lastRating === "hard" && previousLearning.definitionMastery < 14)
  ) {
    rating = "hard";
    inferredConfidence = 2;
    responseBand = "effortful";
    masteryDecision = "learning";
    feedbackTitle = "答对了，但提取还不稳定";
    feedbackDetail = "系统会保守缩短间隔，避免把刚纠正的答案误判为掌握。";
  } else if (!useResponseTime) {
    rating = "good";
    inferredConfidence = 2;
    responseBand = "timing_unscored";
    masteryDecision = previousLearning.definitionMastery >= 55 ? "remembered" : "learning";
    feedbackTitle = "回答正确";
    feedbackDetail = "本次只依据正确性和历史记录安排复习，没有使用作答速度。";
  } else if (normalizedResponseTimeMs > 20_000) {
    rating = "hard";
    inferredConfidence = 1;
    responseBand = "effortful";
    masteryDecision = "learning";
    feedbackTitle = "答对了，但提取还不稳定";
    feedbackDetail = "本次回忆耗时较长，系统会保守缩短复习间隔。";
  } else if (
    normalizedResponseTimeMs <= 6_000
    && previousLearning.reviewCount >= 3
    && previousLearning.definitionMastery >= 60
    && (previousLearning.lastRating === "good" || previousLearning.lastRating === "easy")
  ) {
    rating = "easy";
    inferredConfidence = 3;
    responseBand = "fluent";
    masteryDecision = "fluent";
    feedbackTitle = "快速稳定提取";
    feedbackDetail = "多次间隔复习后仍能快速答对，系统将显著延长下次复习间隔。";
  } else {
    rating = "good";
    inferredConfidence = normalizedResponseTimeMs <= 10_000 ? 3 : 2;
    responseBand = "recalled";
    masteryDecision = previousLearning.definitionMastery >= 55 ? "remembered" : "learning";
    feedbackTitle = "回答正确";
    feedbackDetail = "系统结合正确性、作答速度和历史表现，判定为一次有效回忆。";
  }

  return {
    isCorrect,
    selectedOptionId,
    correctOptionId: question.correctOptionId,
    rating,
    inferredConfidence,
    responseBand,
    masteryDecision,
    feedbackTitle,
    feedbackDetail,
  };
}

export function applyDefinitionQuizAnswer(input: ApplyDefinitionQuizAnswerInput): ApplyDefinitionQuizAnswerResult {
  const {
    question,
    selectedOptionId,
    previousLearning,
    responseTimeMs,
    examDate,
    now = new Date(),
    useResponseTime = true,
  } = input;
  const boundedResponseTime = Number.isFinite(responseTimeMs) && responseTimeMs >= 0
    ? Math.max(300, responseTimeMs)
    : 10_001;
  const evaluation = evaluateDefinitionQuizAnswer(
    question,
    selectedOptionId,
    previousLearning,
    boundedResponseTime,
    useResponseTime,
  );
  const scheduled = applyRating(
    previousLearning,
    evaluation.rating,
    evaluation.inferredConfidence,
    boundedResponseTime,
    examDate,
    now,
  );
  const learning = {
    ...scheduled,
    scheduleReason: `四选一自动判定：${evaluation.feedbackDetail} ${scheduled.scheduleReason}`,
  };
  return { evaluation, learning };
}
