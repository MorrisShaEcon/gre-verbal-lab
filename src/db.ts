import { openDB, type DBSchema } from "idb";
import {
  markIdsAfterCommit,
  parsePendingProfileSnapshot,
  serializePendingProfileSnapshot,
  type PendingProfileSnapshot,
} from "./db-recovery";
import { normalizeStoredMockMistakes } from "./mock-mistakes";
import { ensureLearningStates, isDisplayableGreQuestionMatchState } from "./scheduler";
import {
  createEmptyData,
  type AppData,
  type AppSettings,
  type ContextExample,
  type ContextRightsState,
  type ContextUseScope,
  type DailyPlan,
  type GreQuestionMatch,
  type GreQuestionMatchLocation,
  type GreQuestionOption,
  type LearningState,
  type Pronunciation,
  type RelationNotes,
  type RelationCoverageEvidence,
  type RelationCoverageState,
  type RelationEvidenceState,
  type ReviewEvent,
  type StudyReviewState,
  type VocabularyCatalog,
  type WordEntry,
} from "./types";

interface SenseOverlay {
  contextNote: string;
  relations: RelationNotes;
}

interface LearnerProfile {
  schemaVersion: 2;
  catalogVersion: string;
  learning: Record<string, LearningState>;
  settings: AppSettings;
  importedAt: string | null;
  sourceFiles: string[];
  dailyPlans: Record<string, DailyPlan>;
  mockMistakes: AppData["mockMistakes"];
  overlays: Record<string, SenseOverlay>;
  customWords: WordEntry[];
}

interface GreVerbalDb extends DBSchema {
  state: {
    key: "app";
    value: AppData;
  };
  catalog: {
    key: "active";
    value: VocabularyCatalog;
  };
  profile: {
    key: "current";
    value: LearnerProfile;
  };
  reviewEvents: {
    key: string;
    value: ReviewEvent;
  };
}

const database = openDB<GreVerbalDb>("gre-verbal-lab", 3, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("state")) {
      db.createObjectStore("state");
    }
    if (!db.objectStoreNames.contains("catalog")) db.createObjectStore("catalog");
    if (!db.objectStoreNames.contains("profile")) db.createObjectStore("profile");
    if (!db.objectStoreNames.contains("reviewEvents")) db.createObjectStore("reviewEvents");
  },
});
const fallbackKey = "gre-verbal-lab-app-state";
const pendingProfileKey = "gre-verbal-lab-pending-profile-v1";
let activeCatalogWordIds = new Set<string>();
let persistedReviewEventIds = new Set<string>();
let activeCatalogSenses = new Map<string, WordEntry["senses"][number]>();

type AppRecoverySnapshot = PendingProfileSnapshot<LearnerProfile, ReviewEvent>;

const contextRightsStates = new Set<ContextRightsState>([
  "open_reuse",
  "project_owned",
  "permission_granted",
  "private_user_held",
  "restricted",
  "unknown",
]);
const contextUseScopes = new Set<ContextUseScope>(["public", "private"]);
const relationEvidenceStates = new Set<RelationEvidenceState>(["verified", "user_supplied", "unverified"]);
const relationCoverageStates = new Set<RelationCoverageState>(["verified_present", "source_checked_absent", "unverified"]);
const studyReviewStates = new Set<StudyReviewState>(["unreviewed", "editor_approved", "excluded"]);

function normalizePronunciation(item: Pronunciation): Pronunciation {
  if (item.quality && item.reviewState) return item;
  if (item.source === "Open English WordNet 2025") {
    return { ...item, quality: "dictionary_ipa", reviewState: "source_verified" };
  }
  if (/editorial review/i.test(item.source)) {
    return { ...item, quality: "editor_reviewed", reviewState: "editor_reviewed" };
  }
  return { ...item, quality: "approximate_transcription", reviewState: "auto_transcribed" };
}

function normalizeRelationCoverage(
  value: WordEntry["senses"][number]["relationEvidence"] | undefined,
): WordEntry["senses"][number]["relationEvidence"] {
  const normalizePart = (part: RelationCoverageEvidence | undefined, kind: string): RelationCoverageEvidence => (
    part && relationCoverageStates.has(part.state) && part.source?.trim()
      ? part
      : { state: "unverified" as const, source: `Legacy ${kind} evidence missing; treated as unverified` }
  );
  return {
    synonyms: normalizePart(value?.synonyms, "synonym"),
    antonyms: normalizePart(value?.antonyms, "antonym"),
  };
}

function normalizeLegacyExample(example: ContextExample): ContextExample {
  const rightsState = contextRightsStates.has(example.rightsState) ? example.rightsState : "unknown";
  const allowedIn = Array.isArray(example.allowedIn)
    ? example.allowedIn.filter((scope): scope is ContextUseScope => contextUseScopes.has(scope))
    : [];
  return { ...example, rightsState, allowedIn: [...new Set(allowedIn)] };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safePageNumber(value: unknown): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 0;
}

function normalizeGreQuestionOption(value: unknown): GreQuestionOption | null {
  const record = recordValue(value);
  if (!record) return null;
  return { label: safeString(record.label), text: safeString(record.text) };
}

function normalizeGreQuestionLocation(value: unknown): GreQuestionMatchLocation | null {
  if (typeof value === "string") return value.trim() || null;
  const record = recordValue(value);
  if (!record) return null;
  const field = record.field;
  if (field !== "passageText" && field !== "questionText" && field !== "option") return null;
  const start = Number.isInteger(record.start) && Number(record.start) >= 0 ? Number(record.start) : -1;
  const end = Number.isInteger(record.end) && Number(record.end) > start ? Number(record.end) : -1;
  const result: GreQuestionMatchLocation = { field, start, end };
  const optionLabel = safeString(record.optionLabel);
  if (optionLabel) result.optionLabel = optionLabel;
  return result;
}

function normalizeGreQuestionMatch(value: unknown): GreQuestionMatch | null {
  const record = recordValue(value);
  if (!record) return null;
  if (!isDisplayableGreQuestionMatchState(record.senseMatchState)) return null;
  const passageText = safeString(record.passageText);
  const answerValues = Array.isArray(record.answerValues)
    ? record.answerValues.map(safeString).filter(Boolean)
    : undefined;
  return {
    id: safeString(record.id),
    sourceLabel: safeString(record.sourceLabel),
    sourceFile: safeString(record.sourceFile),
    pageStart: safePageNumber(record.pageStart),
    pageEnd: safePageNumber(record.pageEnd),
    locator: safeString(record.locator),
    questionType: safeString(record.questionType),
    ...(passageText ? { passageText } : {}),
    questionText: safeString(record.questionText),
    options: Array.isArray(record.options)
      ? record.options.map(normalizeGreQuestionOption).filter((item): item is GreQuestionOption => item !== null)
      : [],
    ...(answerValues ? { answerValues } : {}),
    matchedSurface: safeString(record.matchedSurface),
    matchLocations: Array.isArray(record.matchLocations)
      ? record.matchLocations.map(normalizeGreQuestionLocation).filter((item): item is GreQuestionMatchLocation => item !== null)
      : [],
    senseMatchState: record.senseMatchState,
    reviewNote: safeString(record.reviewNote),
  };
}

function normalizeGreQuestionMatches(value: unknown): GreQuestionMatch[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeGreQuestionMatch).filter((item): item is GreQuestionMatch => item !== null);
}

function normalizeLegacyWord(word: WordEntry): WordEntry {
  return {
    ...word,
    pronunciations: (word.pronunciations ?? []).map(normalizePronunciation),
    audioSources: word.audioSources ?? [],
    sourceConsensus: word.sourceConsensus ?? false,
    frequencyProfile: word.frequencyProfile ?? {
      tier: "unranked",
      rank: 0,
      priorityScore: 0,
      localMaterialCount: 0,
      officialMaterialCount: 0,
      evidenceBySource: {},
    },
    senses: word.senses.map((sense) => {
      const hasRelationSource = Boolean(sense.relationSource?.trim());
      const requestedRelationState = hasRelationSource && relationEvidenceStates.has(sense.relationState)
        ? sense.relationState
        : "unverified";
      const relations = sense.relations ?? { synonyms: [], antonyms: [], confusables: [] };
      const relationEvidence = normalizeRelationCoverage(sense.relationEvidence);
      const kindChecked = (kind: "synonyms" | "antonyms") => (
        (relationEvidence[kind].state === "verified_present" && relations[kind].length > 0)
        || (relationEvidence[kind].state === "source_checked_absent" && relations[kind].length === 0)
      );
      const bothKindsChecked = kindChecked("synonyms") && kindChecked("antonyms");
      const relationState = requestedRelationState === "verified" && !bothKindsChecked
        ? "unverified"
        : requestedRelationState;
      return {
        ...sense,
        definitionEn: sense.definitionEn ?? "",
        openSenseId: sense.openSenseId ?? null,
        usageNote: sense.usageNote ?? "",
        contextNote: sense.contextNote ?? "",
        examples: (sense.examples ?? []).map(normalizeLegacyExample),
        greQuestionMatches: normalizeGreQuestionMatches(sense.greQuestionMatches),
        relations,
        confusableSenseIds: sense.confusableSenseIds ?? [],
        confusableRationales: sense.confusableRationales ?? {},
        confusableSource: sense.confusableSource ?? "",
        relationState,
        relationSource: sense.relationSource?.trim()
          ? sense.relationSource
          : "Legacy relation evidence missing; treated as unverified",
        relationEvidence,
        studyReviewState: studyReviewStates.has(sense.studyReviewState) ? sense.studyReviewState : "unreviewed",
        studyReviewNote: sense.studyReviewNote ?? "",
        quizRole: sense.quizRole === "distractor_only" ? "distractor_only" : "target_and_distractor",
        enrichmentState: sense.enrichmentState ?? "missing",
        alignmentState: sense.alignmentState ?? "unverified",
        alignmentScore: Number.isFinite(sense.alignmentScore) ? sense.alignmentScore : 0,
        alignmentSource: sense.alignmentSource ?? "Legacy catalog migration",
      };
    }),
  };
}

function applyOverlays(words: WordEntry[], overlays: Record<string, SenseOverlay>): WordEntry[] {
  return words.map((word) => ({
    ...word,
    senses: word.senses.map((sense) => {
      const overlay = overlays[sense.id];
      if (!overlay) return sense;
      return {
        ...sense,
        contextNote: overlay.contextNote,
        relations: {
          synonyms: [...new Set([...sense.relations.synonyms, ...(overlay.relations?.synonyms ?? [])])],
          antonyms: [...new Set([...sense.relations.antonyms, ...(overlay.relations?.antonyms ?? [])])],
          confusables: [...new Set([...sense.relations.confusables, ...(overlay.relations?.confusables ?? [])])],
        },
      };
    }),
  }));
}

function profileFrom(data: AppData): LearnerProfile {
  const overlays: Record<string, SenseOverlay> = {};
  for (const word of data.words) {
    if (!activeCatalogWordIds.has(word.id)) continue;
    for (const sense of word.senses) {
      const base = activeCatalogSenses.get(sense.id);
      const relations = base
        ? {
            synonyms: sense.relations.synonyms.filter((item) => !base.relations.synonyms.includes(item)),
            antonyms: sense.relations.antonyms.filter((item) => !base.relations.antonyms.includes(item)),
            confusables: sense.relations.confusables.filter((item) => !base.relations.confusables.includes(item)),
          }
        : sense.relations;
      if (!base || sense.contextNote !== base.contextNote || relations.synonyms.length || relations.antonyms.length || relations.confusables.length) {
        overlays[sense.id] = {
          contextNote: sense.contextNote,
          relations,
        };
      }
    }
  }
  return {
    schemaVersion: 2,
    catalogVersion: data.catalogVersion,
    learning: data.learning,
    settings: data.settings,
    importedAt: data.importedAt,
    sourceFiles: data.sourceFiles,
    dailyPlans: data.dailyPlans,
    mockMistakes: data.mockMistakes,
    overlays,
    customWords: data.words.filter((word) => !activeCatalogWordIds.has(word.id)),
  };
}

function appDataFromProfile(
  profile: LearnerProfile,
  reviewEvents: ReviewEvent[],
  catalogWords: WordEntry[],
  catalogVersion: string,
): AppData {
  const customWords = Array.isArray(profile.customWords)
    ? profile.customWords.map(normalizeLegacyWord)
    : [];
  const overlays = profile.overlays && typeof profile.overlays === "object"
    ? profile.overlays
    : {};
  const words = applyOverlays([...catalogWords, ...customWords], overlays);
  const defaults = createEmptyData(words, catalogVersion);
  return {
    ...defaults,
    ...profile,
    schemaVersion: 2,
    catalogVersion,
    words,
    learning: ensureLearningStates(words, profile.learning ?? {}),
    reviewEvents: [...reviewEvents].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt)),
    settings: { ...defaults.settings, ...profile.settings },
    dailyPlans: profile.dailyPlans ?? {},
    mockMistakes: normalizeStoredMockMistakes(profile.mockMistakes),
  };
}

function readPendingProfileSnapshot(): AppRecoverySnapshot | null {
  try {
    return parsePendingProfileSnapshot<LearnerProfile, ReviewEvent>(localStorage.getItem(pendingProfileKey));
  } catch {
    return null;
  }
}

function readLegacyFallback(): AppData | undefined {
  try {
    const raw = localStorage.getItem(fallbackKey);
    return raw ? JSON.parse(raw) as AppData : undefined;
  } catch {
    return undefined;
  }
}

function clearRecoverySnapshots(): void {
  try {
    localStorage.removeItem(pendingProfileKey);
    localStorage.removeItem(fallbackKey);
  } catch {
    // A successful IndexedDB commit is authoritative even if cleanup is blocked.
  }
}

function writePendingProfileSnapshot(data: AppData): void {
  localStorage.setItem(
    pendingProfileKey,
    serializePendingProfileSnapshot(profileFrom(data), data.reviewEvents),
  );
}

function persistenceFailure(error: unknown, fallbackStored: boolean): Error {
  const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
  return new Error(
    fallbackStored
      ? `主数据库保存失败；已保留本地恢复快照，重启后会优先恢复。${detail}`
      : `主数据库和本地恢复快照都保存失败，请立即导出备份。${detail}`,
    { cause: error },
  );
}

export async function loadAppData(catalog: VocabularyCatalog): Promise<AppData> {
  let saved: AppData | undefined;
  let loadedProfile = false;
  let usingPendingSnapshot = false;
  const normalizedCatalogWords = catalog.words.map(normalizeLegacyWord);
  const normalizedCatalog = { ...catalog, words: normalizedCatalogWords };
  const pendingSnapshot = readPendingProfileSnapshot();
  try {
    const db = await database;
    const cachedCatalog = await db.get("catalog", "active");
    if (cachedCatalog?.catalogVersion !== catalog.catalogVersion) await db.put("catalog", normalizedCatalog, "active");
    const profile = await db.get("profile", "current");
    const events = await db.getAll("reviewEvents");
    persistedReviewEventIds = new Set(events.map((event) => event.id));
    if (pendingSnapshot) {
      saved = appDataFromProfile(
        pendingSnapshot.profile,
        pendingSnapshot.reviewEvents,
        normalizedCatalogWords,
        catalog.catalogVersion,
      );
      loadedProfile = true;
      usingPendingSnapshot = true;
    } else if (profile) {
      saved = appDataFromProfile(profile, events, normalizedCatalogWords, catalog.catalogVersion);
      loadedProfile = true;
    } else {
      saved = await db.get("state", "app");
    }
  } catch {
    // The in-memory id index must reflect only a transaction we know committed.
    persistedReviewEventIds = new Set<string>();
    if (pendingSnapshot) {
      saved = appDataFromProfile(
        pendingSnapshot.profile,
        pendingSnapshot.reviewEvents,
        normalizedCatalogWords,
        catalog.catalogVersion,
      );
      loadedProfile = true;
      usingPendingSnapshot = true;
    } else {
      saved = readLegacyFallback();
    }
  }
  activeCatalogWordIds = new Set(normalizedCatalogWords.map((word) => word.id));
  activeCatalogSenses = new Map(normalizedCatalogWords.flatMap((word) => word.senses.map((sense) => [sense.id, sense] as const)));
  if (!saved) {
    const fresh = { ...createEmptyData(normalizedCatalogWords, catalog.catalogVersion), learning: ensureLearningStates(normalizedCatalogWords, {}) };
    await saveAppData(fresh);
    return fresh;
  }

  const legacyWords = new Map((saved.words ?? []).map(normalizeLegacyWord).map((word) => [word.normalizedHeadword, word]));
  const catalogWords = normalizedCatalogWords.map((word) => {
    const legacy = legacyWords.get(word.normalizedHeadword);
    if (!legacy) return word;
    const legacySenses = new Map(legacy.senses.map((sense) => [sense.id, sense]));
    return {
      ...word,
      senses: word.senses.map((sense) => {
        const previous = legacySenses.get(sense.id);
        if (!previous) return sense;
        const relations = {
          synonyms: [...new Set([...sense.relations.synonyms, ...previous.relations.synonyms])],
          antonyms: [...new Set([...sense.relations.antonyms, ...previous.relations.antonyms])],
          confusables: [...new Set([...sense.relations.confusables, ...previous.relations.confusables])],
        };
        return {
          ...sense,
          contextNote: previous.contextNote || sense.contextNote,
          relations,
        };
      }),
    };
  });
  const catalogHeadwords = new Set(catalogWords.map((word) => word.normalizedHeadword));
  const customWords = [...legacyWords.values()].filter((word) => !catalogHeadwords.has(word.normalizedHeadword));
  const words = [...catalogWords, ...customWords];
  const defaults = createEmptyData(words, catalog.catalogVersion);
  const result: AppData = {
    ...defaults,
    ...saved,
    schemaVersion: 2,
    catalogVersion: catalog.catalogVersion,
    words,
    learning: ensureLearningStates(words, saved.learning ?? {}),
    reviewEvents: saved.reviewEvents ?? [],
    dailyPlans: saved.dailyPlans ?? {},
    mockMistakes: normalizeStoredMockMistakes(saved.mockMistakes),
    settings: { ...defaults.settings, ...saved.settings },
  };
  if (usingPendingSnapshot) {
    // Repair the authoritative stores when IndexedDB is available again. If it
    // is still unavailable, replaceAppData refreshes the same pending snapshot.
    try {
      await replaceAppData(result);
    } catch {
      // Startup remains usable from the recovery snapshot; runtime saves still
      // reject and surface the storage failure through the UI save queue.
    }
  } else if (!loadedProfile) {
    await saveAppData(result);
  }
  return result;
}

export async function saveAppData(data: AppData): Promise<void> {
  try {
    const db = await database;
    const transaction = db.transaction(["profile", "reviewEvents"], "readwrite");
    const writes: Array<Promise<unknown>> = [transaction.objectStore("profile").put(profileFrom(data), "current")];
    const eventStore = transaction.objectStore("reviewEvents");
    const newEventIds: string[] = [];
    for (const event of data.reviewEvents) {
      if (persistedReviewEventIds.has(event.id)) continue;
      writes.push(eventStore.put(event, event.id));
      newEventIds.push(event.id);
    }
    await Promise.all(writes);
    await markIdsAfterCommit(transaction.done, persistedReviewEventIds, newEventIds);
    clearRecoverySnapshots();
  } catch (error) {
    try {
      writePendingProfileSnapshot(data);
    } catch {
      throw persistenceFailure(error, false);
    }
    throw persistenceFailure(error, true);
  }
}

/**
 * Atomically replaces the learner profile and review-event log. Backup restore
 * and reset use this instead of the append-only incremental save path.
 */
export async function replaceAppData(data: AppData): Promise<void> {
  try {
    const db = await database;
    const transaction = db.transaction(["profile", "reviewEvents"], "readwrite");
    const profileStore = transaction.objectStore("profile");
    const eventStore = transaction.objectStore("reviewEvents");
    const writes: Array<Promise<unknown>> = [
      profileStore.put(profileFrom(data), "current"),
      eventStore.clear(),
      ...data.reviewEvents.map((event) => eventStore.put(event, event.id)),
    ];
    await Promise.all(writes);
    await transaction.done;
    persistedReviewEventIds = new Set(data.reviewEvents.map((event) => event.id));
    clearRecoverySnapshots();
  } catch (error) {
    try {
      writePendingProfileSnapshot(data);
    } catch {
      throw persistenceFailure(error, false);
    }
    throw persistenceFailure(error, true);
  }
}

export async function resetAppData(words: WordEntry[], catalogVersion: string): Promise<AppData> {
  const empty = { ...createEmptyData(words, catalogVersion), learning: ensureLearningStates(words, {}) };
  await replaceAppData(empty);
  return empty;
}

export function downloadBackup(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `gre-verbal-lab-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readBackup(file: File): Promise<AppData> {
  const parsed = JSON.parse(await file.text()) as Partial<AppData> & { schemaVersion?: number };
  if (![1, 2].includes(parsed.schemaVersion ?? 0) || !Array.isArray(parsed.words) || typeof parsed.learning !== "object") {
    throw new Error("备份文件格式不正确。请选择 GRE Verbal Lab 导出的 JSON 文件。");
  }
  const words = parsed.words.map(normalizeLegacyWord);
  return {
    ...createEmptyData(words, parsed.catalogVersion ?? "restored-v1"),
    ...parsed,
    schemaVersion: 2,
    catalogVersion: parsed.catalogVersion ?? "restored-v1",
    words,
    learning: ensureLearningStates(words, parsed.learning ?? {}),
    reviewEvents: parsed.reviewEvents ?? [],
    settings: { ...createEmptyData().settings, ...parsed.settings },
    importedAt: parsed.importedAt ?? null,
    sourceFiles: parsed.sourceFiles ?? [],
    dailyPlans: parsed.dailyPlans ?? {},
    mockMistakes: normalizeStoredMockMistakes(parsed.mockMistakes),
  };
}
