/**
 * Private, local-first domain model for GRE mock-test mistakes.
 *
 * This module deliberately has no dependency on the vocabulary catalog. A
 * screenshot may be kept as a local data URL for the learner's own records,
 * but the safe export path removes binary data and OCR source text by default.
 * OCR itself is performed outside this module; we only turn OCR output into a
 * reviewable draft.
 */

export const MOCK_MISTAKE_SCHEMA_VERSION = 1 as const;

export const MOCK_QUESTION_TYPES = ["TC", "SE", "RC", "CR", "Quant", "AWA", "Other"] as const;
export type MockQuestionType = (typeof MOCK_QUESTION_TYPES)[number];

export const MOCK_MISTAKE_CAUSES = [
  "vocabulary",
  "sentence_logic",
  "passage_comprehension",
  "evidence_location",
  "option_trap",
  "concept_gap",
  "calculation",
  "time_pressure",
  "careless",
  "guessing",
  "other",
] as const;
export type MockMistakeCause = (typeof MOCK_MISTAKE_CAUSES)[number];

export type MockMistakeStatus = "draft" | "active" | "mastered" | "archived";
export type MockMistakeReviewOutcome = "again" | "hard" | "good" | "easy";

export interface MockQuestionOption {
  id: string;
  label: string;
  text: string;
}

export interface MockAnswer {
  optionIds: string[];
  text?: string;
}

export interface MockMistakeAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  lastModifiedAt?: string;
  /** Private device data only. Safe exports omit this field by default. */
  localDataUrl?: string;
}

export interface MockMistakeOcrEvidence {
  engine: "manual" | "local_ocr" | "external_result";
  /** Raw OCR may contain a complete copyrighted question; omit from safe exports. */
  rawText?: string;
  confidence: number | null;
  capturedAt: string;
}

export interface MockMistakeSource {
  kind: "official" | "practice_test" | "mock_test" | "question_bank" | "unknown";
  label: string;
  mockName: string;
  section?: string;
  questionNumber?: string;
  /** Local filename/locator; safe exports omit it by default. */
  localLocator?: string;
}

export interface MockMistakeAnalysis {
  rootCause: string;
  correctReasoning: string;
  trapAnalysis: string;
  improvementPlan: string;
  notes: string;
}

export interface MockMistakeReviewEvent {
  id: string;
  reviewedAt: string;
  outcome: MockMistakeReviewOutcome;
  wasCorrect: boolean;
  answer?: MockAnswer;
  note: string;
  masteryBefore: number;
  masteryAfter: number;
  nextReviewAt: string;
}

/** A correct, system-graded answer waiting for the learner's difficulty signal. */
export interface MockMistakePendingGradedAttempt {
  answeredAt: string;
  answer: MockAnswer;
  wasCorrect: true;
}

export interface MockMistakeRecord {
  schemaVersion: typeof MOCK_MISTAKE_SCHEMA_VERSION;
  /** Hard boundary: this record must never be merged into VocabularyCatalog. */
  storageScope: "private_local_only";
  id: string;
  status: MockMistakeStatus;
  questionType: MockQuestionType;
  passageText?: string;
  questionText: string;
  options: MockQuestionOption[];
  originalUserAnswer: MockAnswer;
  correctAnswer: MockAnswer;
  errorCauses: MockMistakeCause[];
  analysis: MockMistakeAnalysis;
  linkedWordIds: string[];
  linkedSenseIds: string[];
  source: MockMistakeSource;
  attachments: MockMistakeAttachment[];
  ocr?: MockMistakeOcrEvidence;
  createdAt: string;
  updatedAt: string;
  lastReviewedAt: string | null;
  nextReviewAt: string;
  mastery: number;
  lapses: number;
  reviewCount: number;
  reviewHistory: MockMistakeReviewEvent[];
  /** Persisted immediately so a refresh cannot lose a graded correct attempt. */
  pendingGradedAttempt?: MockMistakePendingGradedAttempt;
}

export interface OcrMistakeDraftInput {
  id?: string;
  questionType?: MockQuestionType;
  rawText: string;
  questionText?: string;
  passageText?: string;
  options?: Array<Partial<MockQuestionOption> & { text: string }>;
  attachment?: MockMistakeAttachment;
  ocrEngine?: MockMistakeOcrEvidence["engine"];
  ocrConfidence?: number | null;
  source?: Partial<MockMistakeSource>;
  /** Explicit clock input keeps draft creation deterministic and testable. */
  createdAt: string | Date;
}

export interface MockMistakeValidationIssue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface ApplyMockMistakeReviewInput {
  outcome: MockMistakeReviewOutcome;
  /** The learner's submitted answer. Correctness is derived from the answer key. */
  answer: MockAnswer;
  note?: string;
  /** Explicit clock input; the scheduler never reads the system clock. */
  reviewedAt: string | Date;
}

export interface SubmitMockMistakeAttemptResult {
  record: MockMistakeRecord;
  wasCorrect: boolean;
  /** Incorrect attempts are immediately recorded as Again; correct ones await difficulty feedback. */
  reviewRecorded: boolean;
}

export interface MockMistakeStats {
  total: number;
  drafts: number;
  active: number;
  mastered: number;
  archived: number;
  due: number;
  overdue: number;
  averageMastery: number;
  totalLapses: number;
  linkedWordCount: number;
  linkedSenseCount: number;
  byQuestionType: Record<MockQuestionType, number>;
  byErrorCause: Record<MockMistakeCause, number>;
}

export interface MockMistakeExportEnvelope {
  kind: "gre_verbal_lab_mock_mistakes";
  schemaVersion: typeof MOCK_MISTAKE_SCHEMA_VERSION;
  visibility: "private_user_data";
  exportedAt: string;
  containsLocalAttachmentData: boolean;
  containsRawOcrText: boolean;
  records: MockMistakeRecord[];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MOCK_MISTAKE_STATUSES = new Set<MockMistakeStatus>(["draft", "active", "mastered", "archived"]);
const DATA_URL_RE = /^data:/i;
const IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i;

function parseDate(value: string | Date, field: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} 必须是有效日期。`);
  return date;
}

function isoDate(value: string | Date, field: string): string {
  return parseDate(value, field).toISOString();
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => value && !seen.has(value) && seen.add(value));
}

function normalizedAnswerText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[()[\]{}\s]+|[()[\]{}\s.]+$/g, "");
}

/** Maps a typed answer such as `B / laconic` back to structured option ids. */
export function mockAnswerFromText(options: MockQuestionOption[], value: string): MockAnswer {
  const text = value.trim();
  if (!text) return { optionIds: [] };
  const fragments = text
    .split(/\s*(?:[,，、;；/|]|\band\b)\s*/i)
    .map(normalizedAnswerText)
    .filter(Boolean);
  const optionIds = options.flatMap((option) => {
    const label = normalizedAnswerText(option.label).replace(/[.):、]+$/g, "");
    const optionText = normalizedAnswerText(option.text);
    return fragments.some((fragment) => fragment.replace(/[.):、]+$/g, "") === label || fragment === optionText)
      ? [option.id]
      : [];
  });
  return { optionIds: uniqueStrings(optionIds), text };
}

function normalizedAnswerOptionIds(record: MockMistakeRecord, answer: MockAnswer): string[] {
  const allowedIds = new Set(record.options.map((option) => option.id));
  const fromIds = answer.optionIds.filter((id) => allowedIds.has(id));
  const fromText = mockAnswerFromText(record.options, answer.text ?? "").optionIds;
  return uniqueStrings([...fromIds, ...fromText]).sort();
}

/** Grades a re-attempt against the stored answer key; callers cannot self-report correctness. */
export function gradeMockMistakeAnswer(record: MockMistakeRecord, answer: MockAnswer): boolean {
  const correctOptionIds = normalizedAnswerOptionIds(record, record.correctAnswer);
  const submittedOptionIds = normalizedAnswerOptionIds(record, answer);
  if (correctOptionIds.length) {
    return correctOptionIds.length === submittedOptionIds.length
      && correctOptionIds.every((id, index) => id === submittedOptionIds[index]);
  }
  const correctText = normalizedAnswerText(record.correctAnswer.text);
  const submittedText = normalizedAnswerText(answer.text);
  return Boolean(correctText && submittedText && correctText === submittedText);
}

function emptyAnalysis(): MockMistakeAnalysis {
  return { rootCause: "", correctReasoning: "", trapAnalysis: "", improvementPlan: "", notes: "" };
}

function emptyAnswer(): MockAnswer {
  return { optionIds: [] };
}

function parseOptionsFromOcr(rawText: string): { questionText: string; options: MockQuestionOption[] } {
  const lines = rawText.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  const questionLines: string[] = [];
  const parsed: Array<{ label: string; lines: string[] }> = [];
  const optionPattern = /^(?:\(([A-H])\)|([A-H])[.):.、])\s*(.+)$/i;

  for (const line of lines) {
    const match = line.match(optionPattern);
    if (match) {
      parsed.push({ label: (match[1] ?? match[2]).toUpperCase(), lines: [match[3].trim()] });
    } else if (parsed.length) {
      parsed[parsed.length - 1].lines.push(line);
    } else {
      questionLines.push(line);
    }
  }

  return {
    questionText: questionLines.join("\n"),
    options: parsed.map((option, index) => ({
      id: `option-${option.label.toLowerCase()}-${index + 1}`,
      label: option.label,
      text: option.lines.join(" ").trim(),
    })),
  };
}

/** Creates a private draft from already-produced OCR text; it performs no OCR or upload. */
export function createMockMistakeDraftFromOcr(input: OcrMistakeDraftInput): MockMistakeRecord {
  const createdAt = isoDate(input.createdAt, "createdAt");
  const parsed = parseOptionsFromOcr(input.rawText);
  const options = (input.options ?? parsed.options).map((option, index) => {
    const label = (option.label ?? String.fromCharCode(65 + index)).trim().toUpperCase();
    return {
      id: option.id?.trim() || `option-${label.toLowerCase()}-${index + 1}`,
      label,
      text: option.text.trim(),
    };
  });
  const source: MockMistakeSource = {
    kind: input.source?.kind ?? "unknown",
    label: input.source?.label?.trim() ?? "",
    mockName: input.source?.mockName?.trim() ?? "",
    section: input.source?.section?.trim() || undefined,
    questionNumber: input.source?.questionNumber?.trim() || undefined,
    localLocator: input.source?.localLocator?.trim() || undefined,
  };
  const identity = `${createdAt}|${input.rawText}|${source.mockName}|${source.questionNumber ?? ""}`;

  return {
    schemaVersion: MOCK_MISTAKE_SCHEMA_VERSION,
    storageScope: "private_local_only",
    id: input.id?.trim() || `mock-mistake-${stableHash(identity)}`,
    status: "draft",
    questionType: input.questionType ?? "Other",
    passageText: input.passageText?.trim() || undefined,
    questionText: input.questionText?.trim() || parsed.questionText,
    options,
    originalUserAnswer: emptyAnswer(),
    correctAnswer: emptyAnswer(),
    errorCauses: [],
    analysis: emptyAnalysis(),
    linkedWordIds: [],
    linkedSenseIds: [],
    source,
    attachments: input.attachment ? [{ ...input.attachment }] : [],
    ocr: {
      engine: input.ocrEngine ?? "external_result",
      rawText: input.rawText,
      confidence: input.ocrConfidence ?? null,
      capturedAt: createdAt,
    },
    createdAt,
    updatedAt: createdAt,
    lastReviewedAt: null,
    nextReviewAt: createdAt,
    mastery: 0,
    lapses: 1,
    reviewCount: 0,
    reviewHistory: [],
  };
}

function readinessIssue(record: MockMistakeRecord, code: string, path: string, message: string): MockMistakeValidationIssue {
  return {
    severity: record.status === "draft" ? "warning" : "error",
    code,
    path,
    message,
  };
}

function validIso(value: string | null): boolean {
  return value === null || Boolean(value && Number.isFinite(new Date(value).getTime()));
}

/** Validates both serialized shape and the minimum information needed for review. */
export function validateMockMistake(record: MockMistakeRecord): MockMistakeValidationIssue[] {
  const issues: MockMistakeValidationIssue[] = [];
  const addError = (code: string, path: string, message: string) => issues.push({ severity: "error", code, path, message });

  if (record.schemaVersion !== MOCK_MISTAKE_SCHEMA_VERSION) addError("schema_version", "schemaVersion", "不支持的错题数据版本。");
  if (record.storageScope !== "private_local_only") addError("storage_scope", "storageScope", "错题记录必须标记为仅保存在本地。");
  if (!MOCK_MISTAKE_STATUSES.has(record.status)) addError("status", "status", "错题状态无效。");
  if (!record.id.trim()) addError("required", "id", "错题 ID 不能为空。");
  if (!MOCK_QUESTION_TYPES.includes(record.questionType)) addError("question_type", "questionType", "题型不在允许范围内。");
  if (!validIso(record.createdAt)) addError("date", "createdAt", "创建时间无效。");
  if (!validIso(record.updatedAt)) addError("date", "updatedAt", "更新时间无效。");
  if (!validIso(record.lastReviewedAt)) addError("date", "lastReviewedAt", "上次复习时间无效。");
  if (!validIso(record.nextReviewAt)) addError("date", "nextReviewAt", "下次复习时间无效。");
  if (!Number.isFinite(record.mastery) || record.mastery < 0 || record.mastery > 1) addError("range", "mastery", "掌握度必须在 0 到 1 之间。");
  if (!Number.isInteger(record.lapses) || record.lapses < 0) addError("integer", "lapses", "错误次数必须是非负整数。");
  if (!Number.isInteger(record.reviewCount) || record.reviewCount < 0) addError("integer", "reviewCount", "复习次数必须是非负整数。");

  const optionIds = record.options.map((option) => option.id);
  if (new Set(optionIds).size !== optionIds.length) addError("duplicate", "options", "选项 ID 不能重复。");
  record.options.forEach((option, index) => {
    if (!option.id.trim()) addError("required", `options.${index}.id`, "选项 ID 不能为空。");
    if (!option.text.trim()) addError("required", `options.${index}.text`, "选项内容不能为空。");
  });
  for (const [path, answer] of [["originalUserAnswer", record.originalUserAnswer], ["correctAnswer", record.correctAnswer]] as const) {
    const invalidIds = answer.optionIds.filter((id) => !optionIds.includes(id));
    if (invalidIds.length) addError("answer_reference", `${path}.optionIds`, `答案引用了不存在的选项：${invalidIds.join(", ")}。`);
    if (new Set(answer.optionIds).size !== answer.optionIds.length) addError("duplicate", `${path}.optionIds`, "答案选项不能重复。");
  }
  if (record.pendingGradedAttempt) {
    const pending = record.pendingGradedAttempt;
    if (!validIso(pending.answeredAt)) addError("date", "pendingGradedAttempt.answeredAt", "待确认作答时间无效。");
    const invalidIds = pending.answer.optionIds.filter((id) => !optionIds.includes(id));
    if (invalidIds.length) addError("answer_reference", "pendingGradedAttempt.answer.optionIds", `待确认答案引用了不存在的选项：${invalidIds.join(", ")}。`);
    if (!pending.answer.optionIds.length && !pending.answer.text?.trim()) addError("required", "pendingGradedAttempt.answer", "待确认作答不能为空。");
    if (pending.wasCorrect !== true || !gradeMockMistakeAnswer(record, pending.answer)) addError("graded_answer", "pendingGradedAttempt", "待确认作答必须是系统判定正确的答案。");
    if (record.status !== "active" && record.status !== "mastered") addError("status", "pendingGradedAttempt", "只有复习中的错题可以保留待确认作答。");
  }

  if (new Set(record.linkedWordIds).size !== record.linkedWordIds.length) addError("duplicate", "linkedWordIds", "关联词 ID 不能重复。");
  if (new Set(record.linkedSenseIds).size !== record.linkedSenseIds.length) addError("duplicate", "linkedSenseIds", "关联义项 ID 不能重复。");
  if (new Set(record.errorCauses).size !== record.errorCauses.length) addError("duplicate", "errorCauses", "错误原因不能重复。");
  if (record.errorCauses.some((cause) => !MOCK_MISTAKE_CAUSES.includes(cause))) addError("error_cause", "errorCauses", "包含不支持的错误原因分类。");

  record.attachments.forEach((attachment, index) => {
    if (!attachment.id.trim() || !attachment.name.trim()) addError("required", `attachments.${index}`, "附件必须包含 ID 和文件名。");
    if (!attachment.mimeType.startsWith("image/")) addError("attachment_type", `attachments.${index}.mimeType`, "错题截图附件必须是图片。");
    if (!Number.isFinite(attachment.sizeBytes) || attachment.sizeBytes < 0) addError("range", `attachments.${index}.sizeBytes`, "附件大小无效。");
    if (attachment.localDataUrl && !IMAGE_DATA_URL_RE.test(attachment.localDataUrl)) addError("data_url", `attachments.${index}.localDataUrl`, "本地截图必须是受支持的图片 data URL。");
  });
  if (record.ocr?.confidence !== null && record.ocr?.confidence !== undefined
    && (!Number.isFinite(record.ocr.confidence) || record.ocr.confidence < 0 || record.ocr.confidence > 1)) {
    addError("range", "ocr.confidence", "OCR 置信度必须在 0 到 1 之间。");
  }

  if (!record.questionText.trim()) issues.push(readinessIssue(record, "ready_question", "questionText", "请先校对题目文本。"));
  const userHasAnswer = Boolean(record.originalUserAnswer.optionIds.length || record.originalUserAnswer.text?.trim());
  const correctHasAnswer = Boolean(record.correctAnswer.optionIds.length || record.correctAnswer.text?.trim());
  if (!userHasAnswer && record.questionType !== "AWA") issues.push(readinessIssue(record, "ready_user_answer", "originalUserAnswer", "请记录当时选择的答案。"));
  if (!correctHasAnswer && record.questionType !== "AWA") issues.push(readinessIssue(record, "ready_correct_answer", "correctAnswer", "请记录正确答案。"));
  if (!record.errorCauses.length) issues.push(readinessIssue(record, "ready_error_cause", "errorCauses", "请至少选择一个错误原因。"));
  if (!record.analysis.correctReasoning.trim()) issues.push(readinessIssue(record, "ready_analysis", "analysis.correctReasoning", "请补充正确解题过程。"));

  return issues;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasStoredMockMistakeShape(value: unknown): value is MockMistakeRecord {
  if (!isObjectRecord(value)) return false;
  return value.schemaVersion === MOCK_MISTAKE_SCHEMA_VERSION
    && value.storageScope === "private_local_only"
    && typeof value.id === "string"
    && typeof value.status === "string"
    && typeof value.questionType === "string"
    && typeof value.questionText === "string"
    && Array.isArray(value.options)
    && isObjectRecord(value.originalUserAnswer)
    && Array.isArray(value.originalUserAnswer.optionIds)
    && isObjectRecord(value.correctAnswer)
    && Array.isArray(value.correctAnswer.optionIds)
    && Array.isArray(value.errorCauses)
    && isObjectRecord(value.analysis)
    && Array.isArray(value.linkedWordIds)
    && Array.isArray(value.linkedSenseIds)
    && isObjectRecord(value.source)
    && Array.isArray(value.attachments)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && (value.lastReviewedAt === null || typeof value.lastReviewedAt === "string")
    && typeof value.nextReviewAt === "string"
    && typeof value.mastery === "number"
    && typeof value.lapses === "number"
    && typeof value.reviewCount === "number"
    && Array.isArray(value.reviewHistory)
    && (value.pendingGradedAttempt === undefined || (
      isObjectRecord(value.pendingGradedAttempt)
      && typeof value.pendingGradedAttempt.answeredAt === "string"
      && value.pendingGradedAttempt.wasCorrect === true
      && isObjectRecord(value.pendingGradedAttempt.answer)
      && Array.isArray(value.pendingGradedAttempt.answer.optionIds)
    ));
}

function cloneMockMistakeRecord(record: MockMistakeRecord): MockMistakeRecord {
  return {
    ...record,
    options: record.options.map((option) => ({ ...option })),
    originalUserAnswer: { ...record.originalUserAnswer, optionIds: [...record.originalUserAnswer.optionIds] },
    correctAnswer: { ...record.correctAnswer, optionIds: [...record.correctAnswer.optionIds] },
    errorCauses: [...record.errorCauses],
    analysis: { ...record.analysis },
    linkedWordIds: [...record.linkedWordIds],
    linkedSenseIds: [...record.linkedSenseIds],
    source: { ...record.source },
    attachments: record.attachments.map((attachment) => ({ ...attachment })),
    ocr: record.ocr ? { ...record.ocr } : undefined,
    pendingGradedAttempt: record.pendingGradedAttempt ? {
      ...record.pendingGradedAttempt,
      answer: { ...record.pendingGradedAttempt.answer, optionIds: [...record.pendingGradedAttempt.answer.optionIds] },
    } : undefined,
    reviewHistory: record.reviewHistory.map((event) => ({
      ...event,
      answer: event.answer ? { ...event.answer, optionIds: [...event.answer.optionIds] } : undefined,
    })),
  };
}

/**
 * Pure migration boundary for IndexedDB, localStorage and restored backups.
 * Older app data had no mockMistakes field, so missing/non-array input becomes
 * an empty list. Malformed records are ignored instead of breaking app startup.
 */
export function normalizeStoredMockMistakes(value: unknown): MockMistakeRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(hasStoredMockMistakeShape)
    .filter((record) => validateMockMistake(record).every((issue) => issue.severity !== "error"))
    .map(cloneMockMistakeRecord);
}

export function isMockMistakeReady(record: MockMistakeRecord): boolean {
  const candidate = { ...record, status: "active" as const };
  return validateMockMistake(candidate).every((issue) => issue.severity !== "error");
}

/** Activates a fully checked draft, or preserves a reviewed record's explicit status after an edit. */
export function activateMockMistake(
  record: MockMistakeRecord,
  updatedAt: string | Date,
  targetStatus: Exclude<MockMistakeStatus, "draft"> = "active",
): MockMistakeRecord {
  const candidate: MockMistakeRecord = {
    ...record,
    status: targetStatus,
    updatedAt: isoDate(updatedAt, "updatedAt"),
    linkedWordIds: uniqueStrings(record.linkedWordIds),
    linkedSenseIds: uniqueStrings(record.linkedSenseIds),
    errorCauses: [...new Set(record.errorCauses)],
  };
  const errors = validateMockMistake(candidate).filter((issue) => issue.severity === "error");
  if (errors.length) throw new Error(`错题尚不能进入复习：${errors.map((issue) => issue.message).join(" ")}`);
  return candidate;
}

function clampMastery(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 1_000) / 1_000));
}

function reviewSchedule(outcome: MockMistakeReviewOutcome, currentMastery: number, reviewCount: number) {
  if (outcome === "again") return { mastery: clampMastery(currentMastery - 0.2), delayMs: 10 * 60_000 };
  if (outcome === "hard") return { mastery: clampMastery(currentMastery + 0.08), delayMs: DAY_MS };
  if (outcome === "good") {
    const mastery = clampMastery(currentMastery + 0.18);
    const days = Math.max(2, Math.round(2 * 1.8 ** Math.min(reviewCount, 4) * (0.7 + mastery)));
    return { mastery, delayMs: days * DAY_MS };
  }
  const mastery = clampMastery(currentMastery + 0.28);
  const days = Math.max(5, Math.round(5 * 2 ** Math.min(reviewCount, 4) * (0.7 + mastery)));
  return { mastery, delayMs: days * DAY_MS };
}

function cloneAnswer(answer: MockAnswer): MockAnswer {
  return { ...answer, optionIds: [...answer.optionIds] };
}

function assertReviewableAt(record: MockMistakeRecord, reviewedAt: Date): void {
  if (record.status === "draft") throw new Error("请先补全并启用这道错题，再开始复习。");
  if (record.status === "archived") throw new Error("已归档的错题不能直接复习。");
  if (reviewedAt.getTime() < parseDate(record.nextReviewAt, "nextReviewAt").getTime()) {
    throw new Error("这道错题尚未到复习时间。");
  }
}

/**
 * Persists grading immediately. Incorrect answers become one Again review;
 * correct answers remain pending until the learner supplies difficulty.
 */
export function submitMockMistakeAttempt(
  record: MockMistakeRecord,
  submittedAnswer: MockAnswer,
  answeredAtInput: string | Date,
): SubmitMockMistakeAttemptResult {
  if (record.pendingGradedAttempt) throw new Error("本次正确作答已经判分，请先选择难度反馈。");
  const answeredAt = parseDate(answeredAtInput, "answeredAt");
  assertReviewableAt(record, answeredAt);
  const answer = cloneAnswer(submittedAnswer);
  if (!answer.optionIds.length && !answer.text?.trim()) throw new Error("请先提交本次答案。");
  const wasCorrect = gradeMockMistakeAnswer(record, answer);
  if (!wasCorrect) {
    return {
      record: applyMockMistakeReview(record, { outcome: "again", answer, reviewedAt: answeredAt }),
      wasCorrect: false,
      reviewRecorded: true,
    };
  }
  return {
    record: {
      ...record,
      updatedAt: answeredAt.toISOString(),
      pendingGradedAttempt: {
        answeredAt: answeredAt.toISOString(),
        answer,
        wasCorrect: true,
      },
    },
    wasCorrect: true,
    reviewRecorded: false,
  };
}

/** Applies one later re-attempt and schedules the next reinforcement review. */
export function applyMockMistakeReview(record: MockMistakeRecord, input: ApplyMockMistakeReviewInput): MockMistakeRecord {
  const reviewedAt = parseDate(input.reviewedAt, "reviewedAt");
  assertReviewableAt(record, reviewedAt);
  const answer = cloneAnswer(record.pendingGradedAttempt?.answer ?? input.answer);
  const hasSubmittedAnswer = answer.optionIds.length > 0 || Boolean(answer.text?.trim());
  if (!hasSubmittedAnswer) throw new Error("请先提交本次答案。");
  const wasCorrect = gradeMockMistakeAnswer(record, answer);
  const outcome = wasCorrect ? input.outcome : "again";
  const schedule = reviewSchedule(outcome, record.mastery, record.reviewCount);
  const nextReviewAt = new Date(reviewedAt.getTime() + schedule.delayMs).toISOString();
  const event: MockMistakeReviewEvent = {
    id: `mock-review-${stableHash(`${record.id}|${reviewedAt.toISOString()}|${record.reviewCount + 1}`)}`,
    reviewedAt: reviewedAt.toISOString(),
    outcome,
    wasCorrect,
    answer,
    note: input.note?.trim() ?? "",
    masteryBefore: record.mastery,
    masteryAfter: schedule.mastery,
    nextReviewAt,
  };

  return {
    ...record,
    status: schedule.mastery >= 0.85 ? "mastered" : "active",
    mastery: schedule.mastery,
    lapses: record.lapses + (outcome === "again" ? 1 : 0),
    reviewCount: record.reviewCount + 1,
    lastReviewedAt: reviewedAt.toISOString(),
    nextReviewAt,
    updatedAt: reviewedAt.toISOString(),
    pendingGradedAttempt: undefined,
    reviewHistory: [...record.reviewHistory, event],
  };
}

/** Returns only currently due, reviewable records in deterministic priority order. */
export function sortDueMockMistakes(records: MockMistakeRecord[], now: string | Date, limit = Number.POSITIVE_INFINITY): MockMistakeRecord[] {
  const nowMs = parseDate(now, "now").getTime();
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : records.length;
  return records
    .filter((record) => (record.status === "active" || record.status === "mastered") && new Date(record.nextReviewAt).getTime() <= nowMs)
    .sort((left, right) => (
      new Date(left.nextReviewAt).getTime() - new Date(right.nextReviewAt).getTime()
      || left.mastery - right.mastery
      || right.lapses - left.lapses
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id)
    ))
    .slice(0, normalizedLimit);
}

function zeroRecord<T extends readonly string[]>(keys: T): Record<T[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T[number], number>;
}

/** Aggregates dashboard metrics without exposing screenshot or question content. */
export function aggregateMockMistakeStats(records: MockMistakeRecord[], now: string | Date): MockMistakeStats {
  const nowMs = parseDate(now, "now").getTime();
  const byQuestionType = zeroRecord(MOCK_QUESTION_TYPES);
  const byErrorCause = zeroRecord(MOCK_MISTAKE_CAUSES);
  const linkedWords = new Set<string>();
  const linkedSenses = new Set<string>();
  let due = 0;
  let overdue = 0;

  for (const record of records) {
    byQuestionType[record.questionType] += 1;
    record.errorCauses.forEach((cause) => { byErrorCause[cause] += 1; });
    record.linkedWordIds.forEach((id) => linkedWords.add(id));
    record.linkedSenseIds.forEach((id) => linkedSenses.add(id));
    if ((record.status === "active" || record.status === "mastered") && new Date(record.nextReviewAt).getTime() <= nowMs) {
      due += 1;
      if (new Date(record.nextReviewAt).getTime() < nowMs - HOUR_MS) overdue += 1;
    }
  }

  const averageMastery = records.length
    ? Math.round(records.reduce((sum, record) => sum + record.mastery, 0) / records.length * 10_000) / 10_000
    : 0;
  return {
    total: records.length,
    drafts: records.filter((record) => record.status === "draft").length,
    active: records.filter((record) => record.status === "active").length,
    mastered: records.filter((record) => record.status === "mastered").length,
    archived: records.filter((record) => record.status === "archived").length,
    due,
    overdue,
    averageMastery,
    totalLapses: records.reduce((sum, record) => sum + record.lapses, 0),
    linkedWordCount: linkedWords.size,
    linkedSenseCount: linkedSenses.size,
    byQuestionType,
    byErrorCause,
  };
}

export interface SafeExportOptions {
  includeLocalAttachmentData?: boolean;
  includeRawOcrText?: boolean;
  includeLocalLocators?: boolean;
}

function removeUnexpectedDataUrls<T>(value: T): T {
  if (typeof value === "string") return (DATA_URL_RE.test(value) ? "[local data omitted]" : value) as T;
  if (Array.isArray(value)) return value.map((item) => removeUnexpectedDataUrls(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, removeUnexpectedDataUrls(item)])) as T;
  }
  return value;
}

/**
 * Produces a separate private-user-data envelope, never a catalog payload.
 * Binary screenshots, raw OCR and local paths are stripped unless explicitly
 * requested for a private backup.
 */
export function createSafeMockMistakeExport(
  records: MockMistakeRecord[],
  exportedAt: string | Date,
  options: SafeExportOptions = {},
): MockMistakeExportEnvelope {
  const safeRecords = records.map((record) => {
    const clone = cloneMockMistakeRecord(record);
    if (!options.includeLocalAttachmentData) clone.attachments.forEach((attachment) => { delete attachment.localDataUrl; });
    if (!options.includeRawOcrText && clone.ocr) delete clone.ocr.rawText;
    if (!options.includeLocalLocators) delete clone.source.localLocator;
    return options.includeLocalAttachmentData ? clone : removeUnexpectedDataUrls(clone);
  });

  return {
    kind: "gre_verbal_lab_mock_mistakes",
    schemaVersion: MOCK_MISTAKE_SCHEMA_VERSION,
    visibility: "private_user_data",
    exportedAt: isoDate(exportedAt, "exportedAt"),
    containsLocalAttachmentData: Boolean(options.includeLocalAttachmentData),
    containsRawOcrText: Boolean(options.includeRawOcrText),
    records: safeRecords,
  };
}
