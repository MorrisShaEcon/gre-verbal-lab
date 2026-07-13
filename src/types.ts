import type { MockMistakeRecord } from "./mock-mistakes";

export type Rating = "again" | "hard" | "good" | "easy";
export type Confidence = 1 | 2 | 3;
export type FrequencyTier = "focus" | "long-tail" | "unranked";

export type PronunciationQuality = "dictionary_ipa" | "editor_reviewed" | "approximate_transcription";
export type PronunciationReviewState = "source_verified" | "editor_reviewed" | "auto_transcribed";

export interface Pronunciation {
  ipa: string;
  dialect: string;
  source: string;
  quality: PronunciationQuality;
  reviewState: PronunciationReviewState;
  sourceUrl?: string;
  license?: string;
  phonemes?: string[];
}

export interface PronunciationAudio {
  id: string;
  fileTitle: string;
  url: string;
  sourcePageUrl: string;
  sourceLabel: string;
  creator: string;
  license: string;
  licenseUrl: string;
  dialect: string;
  languageCode?: string;
  languageEvidence?: string;
  human: boolean;
  mimeType?: string;
}

export type ContextRightsState =
  | "open_reuse"
  | "project_owned"
  | "permission_granted"
  | "private_user_held"
  | "restricted"
  | "unknown";

export type ContextUseScope = "public" | "private";

export interface ContextExample {
  id: string;
  text: string;
  kind: "dictionary" | "gre_official" | "screen_dialogue" | "original_gre_style" | "private_reference";
  sourceLabel: string;
  provenance: string;
  reviewState: "source_verified" | "editor_reviewed" | "auto_candidate";
  rightsState: ContextRightsState;
  allowedIn: ContextUseScope[];
  translationZh?: string;
  sourceUrl?: string;
  sourceLocator?: string;
}

export interface FrequencyProfile {
  tier: FrequencyTier;
  rank: number;
  priorityScore: number;
  localMaterialCount: number;
  officialMaterialCount: number;
  evidenceBySource: Record<string, number>;
}

export interface RelationNotes {
  synonyms: string[];
  antonyms: string[];
  confusables: string[];
}

export type RelationEvidenceState = "verified" | "user_supplied" | "unverified";
export type StudyReviewState = "unreviewed" | "editor_approved" | "excluded";
export type QuizContentRole = "target_and_distractor" | "distractor_only";

export type RelationCoverageState = "verified_present" | "source_checked_absent" | "unverified";

export interface RelationCoverageEvidence {
  state: RelationCoverageState;
  source: string;
}

export interface RelationEvidenceByKind {
  synonyms: RelationCoverageEvidence;
  antonyms: RelationCoverageEvidence;
}

export interface GreQuestionOption {
  label: string;
  text: string;
}

export interface GreQuestionTextSpan {
  field: "passageText" | "questionText" | "option";
  start: number;
  end: number;
  optionLabel?: string;
}

/** A compact locator string or a character-level span produced during review. */
export type GreQuestionMatchLocation = string | GreQuestionTextSpan;

/**
 * A privately held local GRE question matched to one vocabulary sense.
 * `confirmed_sense` requires editorial semantic review; `word_form_only`
 * records a lexical hit that may belong to another meaning.
 */
export interface GreQuestionMatch {
  id: string;
  sourceLabel: string;
  sourceFile: string;
  pageStart: number;
  pageEnd: number;
  locator: string;
  questionType: string;
  passageText?: string;
  questionText: string;
  options: GreQuestionOption[];
  answerValues?: string[];
  matchedSurface: string;
  matchLocations: GreQuestionMatchLocation[];
  senseMatchState: "confirmed_sense" | "word_form_only";
  reviewNote: string;
}

export interface GreQuestionMatchStats {
  corpusReviewState: "pending_review" | "reviewed" | "scanned_no_candidate";
  availableCorpusWordFormMatches: number;
  exactCorpusMatches: number;
  inflectionCandidates: number;
  reviewedBindings: number;
  unreviewedCandidates: number;
  confirmedSenseBindings: number;
  wordFormOnlyBindings: number;
  rejectedBindings: number;
  selectedMatches: number;
  omittedByLimit: number;
}

export interface WordSense {
  id: string;
  partOfSpeech: string;
  definitionZh: string;
  definitionEn: string;
  sourceLabel: string;
  openSenseId: string | null;
  usageNote: string;
  contextNote: string;
  examples: ContextExample[];
  greQuestionMatches?: GreQuestionMatch[];
  greQuestionMatchStats?: GreQuestionMatchStats;
  relations: RelationNotes;
  /** Exact, editorially reviewed sense targets used to seed semantic distractors. */
  confusableSenseIds?: string[];
  confusableRationales?: Record<string, string>;
  confusableSource?: string;
  relationState: RelationEvidenceState;
  relationSource: string;
  relationEvidence: RelationEvidenceByKind;
  studyReviewState: StudyReviewState;
  studyReviewNote: string;
  quizRole?: QuizContentRole;
  enrichmentState: "editor_reviewed" | "auto_candidate" | "missing";
  alignmentState: "verified" | "candidate" | "unverified";
  alignmentScore: number;
  alignmentSource: string;
}

export interface WordEntry {
  id: string;
  headword: string;
  normalizedHeadword: string;
  pronunciations: Pronunciation[];
  audioSources: PronunciationAudio[];
  senses: WordSense[];
  sourceFiles: string[];
  initialLapses: number;
  sourceConsensus: boolean;
  frequencyProfile: FrequencyProfile;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface LearningState {
  senseId: string;
  reviewCount: number;
  lapseCount: number;
  stabilityDays: number;
  difficulty: number;
  definitionMastery: number;
  relationshipMastery: number;
  contextMastery: number;
  lastReviewedAt: string | null;
  nextReviewAt: string;
  lastRating: Rating | null;
  lastConfidence: Confidence | null;
  lastResponseTimeMs: number | null;
  scheduleReason: string;
}

export interface ReviewEvent {
  id: string;
  senseId: string;
  wordId: string;
  kind: "review" | "mistake";
  rating: Rating;
  confidence: Confidence;
  responseTimeMs: number;
  reason: string;
  note: string;
  reviewedAt: string;
  catalogVersion?: string;
  questionType?: "definition_mcq";
  questionId?: string;
  selectedOptionId?: string;
  selectedSenseId?: string;
  correctOptionId?: string;
  isCorrect?: boolean;
  responseBand?: "incorrect" | "first_exposure" | "effortful" | "recalled" | "fluent" | "timing_unscored";
  distractorSenseIds?: string[];
}

export interface AppSettings {
  examDate: string;
  dailyNewWords: number;
  dailyReviewLimit: number;
  useResponseTime: boolean;
  audioPlaybackRate: number;
}

export interface AppData {
  schemaVersion: 2;
  catalogVersion: string;
  words: WordEntry[];
  learning: Record<string, LearningState>;
  reviewEvents: ReviewEvent[];
  settings: AppSettings;
  importedAt: string | null;
  sourceFiles: string[];
  dailyPlans: Record<string, DailyPlan>;
  mockMistakes: MockMistakeRecord[];
}

export interface ActiveStudySession {
  id: string;
  kind: "additional_new_words";
  date: string;
  catalogVersion: string;
  /** Full queue order, including any same-session retry appended after an error. */
  queueSenseIds: string[];
  /** Index of the next unanswered card. */
  nextIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface DailyPlan {
  date: string;
  catalogVersion: string;
  /** Normalized daily new-word target used to generate this plan. */
  targetNewWords?: number;
  seed: number;
  wordIds: string[];
  focusCount: number;
  longTailCount: number;
  generatedAt: string;
  /** Optional so daily plans written by earlier releases remain readable. */
  activeSession?: ActiveStudySession;
}

export interface VocabularyCatalog {
  schemaVersion: 2;
  catalogVersion: string;
  generatedAt: string;
  visibility: string;
  samplingPolicy: { focusShare: number; longTailShare: number; description: string };
  provenance: Array<{ id: string; label: string; url?: string; license?: string; visibility?: string; role?: string }>;
  words: WordEntry[];
}

export interface QueueItem {
  word: WordEntry;
  sense: WordSense;
  learning: LearningState;
  reason: string;
  isNew: boolean;
}

export const defaultSettings: AppSettings = {
  examDate: "2026-10-15",
  dailyNewWords: 20,
  dailyReviewLimit: 40,
  useResponseTime: true,
  audioPlaybackRate: 1,
};

export const createEmptyData = (words: WordEntry[] = [], catalogVersion = ""): AppData => ({
  schemaVersion: 2,
  catalogVersion,
  words,
  learning: {},
  reviewEvents: [],
  settings: { ...defaultSettings },
  importedAt: null,
  sourceFiles: [],
  dailyPlans: {},
  mockMistakes: [],
});

export function stableId(prefix: string, input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}
