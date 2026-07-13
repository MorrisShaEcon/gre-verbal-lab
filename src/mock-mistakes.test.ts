import { describe, expect, it } from "vitest";
import {
  activateMockMistake,
  aggregateMockMistakeStats,
  applyMockMistakeReview,
  createMockMistakeDraftFromOcr,
  createSafeMockMistakeExport,
  gradeMockMistakeAnswer,
  isMockMistakeReady,
  mockAnswerFromText,
  normalizeStoredMockMistakes,
  sortDueMockMistakes,
  submitMockMistakeAttempt,
  validateMockMistake,
  type MockMistakeRecord,
} from "./mock-mistakes";
import { createEmptyData } from "./types";

const NOW = "2026-07-13T09:00:00.000Z";

function readyMistake(overrides: Partial<MockMistakeRecord> = {}): MockMistakeRecord {
  const draft = createMockMistakeDraftFromOcr({
    id: "mistake-1",
    questionType: "TC",
    rawText: "The author's praise was anything but _____.\n(A) sincere\n(B) perfunctory\n(C) lucid\n(D) lavish",
    attachment: {
      id: "attachment-1",
      name: "question.png",
      mimeType: "image/png",
      sizeBytes: 120,
      localDataUrl: "data:image/png;base64,aGVsbG8=",
    },
    source: {
      kind: "mock_test",
      label: "Personal GRE materials",
      mockName: "Mock 3",
      questionNumber: "12",
      localLocator: "/private/mock-3.pdf#page=4",
    },
    createdAt: NOW,
  });
  const complete: MockMistakeRecord = {
    ...draft,
    status: "active",
    originalUserAnswer: { optionIds: [draft.options[1].id] },
    correctAnswer: { optionIds: [draft.options[0].id] },
    errorCauses: ["sentence_logic", "option_trap"],
    analysis: {
      rootCause: "Misread the contrast marker.",
      correctReasoning: "Anything but reverses the surface praise.",
      trapAnalysis: "Perfunctory looked negative but did not fit the intended claim.",
      improvementPlan: "Underline polarity markers before considering choices.",
      notes: "",
    },
    linkedWordIds: ["word-sincere"],
    linkedSenseIds: ["sense-sincere-1"],
  };
  return { ...complete, ...overrides };
}

describe("private mock-mistake domain", () => {
  it("gives new and legacy app data a safe empty persistence default", () => {
    expect(createEmptyData().mockMistakes).toEqual([]);
    expect(normalizeStoredMockMistakes(undefined)).toEqual([]);
    expect(normalizeStoredMockMistakes(null)).toEqual([]);
    expect(normalizeStoredMockMistakes({ legacy: true })).toEqual([]);
  });

  it("restores valid private mistake records while dropping malformed backup rows", () => {
    const valid = readyMistake();
    const restored = normalizeStoredMockMistakes([
      valid,
      { schemaVersion: 1, storageScope: "public", id: "unsafe" },
      { schemaVersion: 1, storageScope: "private_local_only", id: "incomplete" },
    ]);

    expect(restored).toHaveLength(1);
    expect(restored[0]).toEqual(valid);
    expect(restored[0]).not.toBe(valid);
    expect(restored[0].attachments[0]).not.toBe(valid.attachments[0]);
    expect(restored[0].attachments[0].localDataUrl).toContain("data:image/png");
  });

  it("creates a deterministic, reviewable draft from OCR output without doing OCR or upload", () => {
    const first = createMockMistakeDraftFromOcr({
      questionType: "SE",
      rawText: "Choose two answers.\nA. candid\nB. evasive\nC. frank\nD. opaque",
      ocrEngine: "local_ocr",
      ocrConfidence: 0.91,
      createdAt: NOW,
    });
    const repeated = createMockMistakeDraftFromOcr({
      questionType: "SE",
      rawText: "Choose two answers.\nA. candid\nB. evasive\nC. frank\nD. opaque",
      ocrEngine: "local_ocr",
      ocrConfidence: 0.91,
      createdAt: NOW,
    });

    expect(first).toEqual(repeated);
    expect(first.storageScope).toBe("private_local_only");
    expect(first.status).toBe("draft");
    expect(first.questionText).toBe("Choose two answers.");
    expect(first.options.map((option) => [option.label, option.text])).toEqual([
      ["A", "candid"],
      ["B", "evasive"],
      ["C", "frank"],
      ["D", "opaque"],
    ]);
    expect(first.ocr).toMatchObject({ engine: "local_ocr", confidence: 0.91 });
    expect(first.lapses).toBe(1);
  });

  it("keeps incomplete OCR records as drafts and blocks activation until answers and analysis are checked", () => {
    const draft = createMockMistakeDraftFromOcr({ rawText: "Unparsed screenshot", createdAt: NOW });
    const issues = validateMockMistake(draft);

    expect(issues.filter((issue) => issue.severity === "warning").map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "ready_user_answer",
      "ready_correct_answer",
      "ready_error_cause",
      "ready_analysis",
    ]));
    expect(isMockMistakeReady(draft)).toBe(false);
    expect(() => activateMockMistake(draft, NOW)).toThrow("错题尚不能进入复习");
  });

  it("validates answer references, attachment data and serialization ranges", () => {
    const invalid = readyMistake({
      mastery: 2,
      correctAnswer: { optionIds: ["missing-option"] },
      attachments: [{
        id: "bad",
        name: "bad.txt",
        mimeType: "text/plain",
        sizeBytes: -1,
        localDataUrl: "data:text/plain;base64,aGk=",
      }],
    });
    const issues = validateMockMistake(invalid);
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["range", "answer_reference", "attachment_type", "data_url"]));
  });

  it("activates a checked record without mutating the draft", () => {
    const complete = readyMistake({ status: "draft" });
    const activated = activateMockMistake(complete, "2026-07-13T10:00:00.000Z");

    expect(complete.status).toBe("draft");
    expect(activated.status).toBe("active");
    expect(isMockMistakeReady(activated)).toBe(true);
    expect(activated.updatedAt).toBe("2026-07-13T10:00:00.000Z");
  });

  it("preserves mastered or archived status when a complete record is edited", () => {
    const complete = readyMistake({ status: "draft" });
    const mastered = activateMockMistake(complete, "2026-07-13T10:00:00.000Z", "mastered");
    const archived = activateMockMistake(complete, "2026-07-13T10:00:00.000Z", "archived");

    expect(mastered.status).toBe("mastered");
    expect(archived.status).toBe("archived");
    expect(isMockMistakeReady(mastered)).toBe(true);
    expect(isMockMistakeReady(archived)).toBe(true);
  });

  it("turns a failed re-attempt into another lapse and a ten-minute retry", () => {
    const record = readyMistake({ mastery: 0.4, lapses: 2 });
    const reviewed = applyMockMistakeReview(record, {
      outcome: "again",
      answer: { optionIds: [record.options[1].id] },
      note: "Still missed the polarity marker.",
      reviewedAt: NOW,
    });

    expect(record.reviewHistory).toHaveLength(0);
    expect(reviewed.mastery).toBe(0.2);
    expect(reviewed.lapses).toBe(3);
    expect(reviewed.reviewCount).toBe(1);
    expect(new Date(reviewed.nextReviewAt).getTime() - new Date(NOW).getTime()).toBe(10 * 60_000);
    expect(reviewed.reviewHistory[0]).toMatchObject({ outcome: "again", wasCorrect: false, masteryBefore: 0.4, masteryAfter: 0.2 });
  });

  it("raises mastery after successful reviews and preserves repeated review history", () => {
    let record = readyMistake({ mastery: 0.75, reviewCount: 3 });
    record = applyMockMistakeReview(record, {
      outcome: "easy",
      answer: { optionIds: [record.options[0].id] },
      reviewedAt: NOW,
    });

    expect(record.mastery).toBe(1);
    expect(record.status).toBe("mastered");
    expect(record.reviewHistory).toHaveLength(1);
    expect(new Date(record.nextReviewAt).getTime()).toBeGreaterThan(new Date(NOW).getTime() + 4 * 86_400_000);
  });

  it("maps typed answer labels to option ids and grades without self-reported correctness", () => {
    const record = readyMistake();
    const typed = mockAnswerFromText(record.options, "A / sincere");

    expect(typed.optionIds).toEqual([record.options[0].id]);
    expect(gradeMockMistakeAnswer(record, typed)).toBe(true);
    expect(gradeMockMistakeAnswer(record, { optionIds: [record.options[1].id] })).toBe(false);
    expect(gradeMockMistakeAnswer({
      ...record,
      correctAnswer: { optionIds: [], text: "A / sincere" },
    }, { optionIds: [record.options[0].id] })).toBe(true);
  });

  it("forces an incorrect answer to Again even when the caller requests Easy", () => {
    const record = readyMistake({ mastery: 0.6, lapses: 1 });
    const reviewed = applyMockMistakeReview(record, {
      outcome: "easy",
      answer: { optionIds: [record.options[1].id] },
      reviewedAt: NOW,
    });

    expect(reviewed.mastery).toBe(0.4);
    expect(reviewed.lapses).toBe(2);
    expect(reviewed.reviewHistory[0]).toMatchObject({ outcome: "again", wasCorrect: false });
  });

  it("persists a correct graded attempt before difficulty feedback and finalizes exactly one review", () => {
    const record = readyMistake({ mastery: 0.5, reviewCount: 2 });
    const submitted = submitMockMistakeAttempt(record, { optionIds: [record.options[0].id] }, NOW);

    expect(submitted).toMatchObject({ wasCorrect: true, reviewRecorded: false });
    expect(submitted.record.mastery).toBe(0.5);
    expect(submitted.record.reviewCount).toBe(2);
    expect(submitted.record.reviewHistory).toHaveLength(0);
    expect(submitted.record.pendingGradedAttempt).toMatchObject({
      answeredAt: NOW,
      wasCorrect: true,
      answer: { optionIds: [record.options[0].id] },
    });

    const restored = normalizeStoredMockMistakes([submitted.record])[0];
    expect(restored.pendingGradedAttempt).toEqual(submitted.record.pendingGradedAttempt);
    expect(restored.pendingGradedAttempt).not.toBe(submitted.record.pendingGradedAttempt);
    expect(() => submitMockMistakeAttempt(restored, { optionIds: [record.options[0].id] }, NOW)).toThrow("已经判分");

    const finalized = applyMockMistakeReview(restored, {
      outcome: "hard",
      // The persisted graded answer is authoritative even if a stale caller supplies another value.
      answer: { optionIds: [record.options[1].id] },
      reviewedAt: "2026-07-13T09:01:00.000Z",
    });
    expect(finalized.pendingGradedAttempt).toBeUndefined();
    expect(finalized.reviewCount).toBe(3);
    expect(finalized.reviewHistory).toHaveLength(1);
    expect(finalized.reviewHistory[0]).toMatchObject({ outcome: "hard", wasCorrect: true });
  });

  it("records an incorrect submitted answer immediately as one Again review", () => {
    const record = readyMistake({ mastery: 0.6, lapses: 1 });
    const submitted = submitMockMistakeAttempt(record, { optionIds: [record.options[1].id] }, NOW);

    expect(submitted).toMatchObject({ wasCorrect: false, reviewRecorded: true });
    expect(submitted.record.pendingGradedAttempt).toBeUndefined();
    expect(submitted.record.reviewCount).toBe(1);
    expect(submitted.record.reviewHistory).toHaveLength(1);
    expect(submitted.record.reviewHistory[0]).toMatchObject({ outcome: "again", wasCorrect: false });
    expect(() => submitMockMistakeAttempt(
      submitted.record,
      { optionIds: [record.options[1].id] },
      NOW,
    )).toThrow("尚未到复习时间");
  });

  it("rejects a re-attempt before its due time", () => {
    const record = readyMistake({ nextReviewAt: "2026-07-14T09:00:00.000Z" });
    expect(() => applyMockMistakeReview(record, {
      outcome: "easy",
      answer: { optionIds: [record.options[0].id] },
      reviewedAt: NOW,
    })).toThrow("尚未到复习时间");
  });

  it("sorts only due active or mastered records by due time, then learning need", () => {
    const later = readyMistake({ id: "later", nextReviewAt: "2026-07-13T08:00:00.000Z", mastery: 0.2, lapses: 4 });
    const earlier = readyMistake({ id: "earlier", nextReviewAt: "2026-07-12T09:00:00.000Z", mastery: 0.8 });
    const future = readyMistake({ id: "future", nextReviewAt: "2026-07-14T09:00:00.000Z" });
    const draft = readyMistake({ id: "draft", status: "draft", nextReviewAt: "2026-07-11T09:00:00.000Z" });

    expect(sortDueMockMistakes([later, future, draft, earlier], NOW).map((record) => record.id)).toEqual(["earlier", "later"]);
    expect(sortDueMockMistakes([later, earlier], NOW, 1).map((record) => record.id)).toEqual(["earlier"]);
  });

  it("aggregates dashboard statistics without reading screenshot content", () => {
    const tc = readyMistake({ id: "tc", mastery: 0.2, lapses: 3, nextReviewAt: "2026-07-12T09:00:00.000Z" });
    const rc = readyMistake({
      id: "rc",
      questionType: "RC",
      mastery: 0.8,
      lapses: 1,
      nextReviewAt: "2026-07-14T09:00:00.000Z",
      errorCauses: ["passage_comprehension"],
      linkedWordIds: ["word-sincere", "word-lucid"],
      linkedSenseIds: [],
    });
    const stats = aggregateMockMistakeStats([tc, rc], NOW);

    expect(stats).toMatchObject({ total: 2, active: 2, due: 1, overdue: 1, averageMastery: 0.5, totalLapses: 4 });
    expect(stats.byQuestionType).toMatchObject({ TC: 1, RC: 1, SE: 0 });
    expect(stats.byErrorCause).toMatchObject({ option_trap: 1, passage_comprehension: 1 });
    expect(stats.linkedWordCount).toBe(2);
    expect(stats.linkedSenseCount).toBe(1);
  });

  it("creates a separate safe export and strips screenshots, raw OCR and local paths by default", () => {
    const record = readyMistake();
    const safe = createSafeMockMistakeExport([record], "2026-07-13T12:00:00.000Z");
    const json = JSON.stringify(safe);

    expect(safe.kind).toBe("gre_verbal_lab_mock_mistakes");
    expect(safe.visibility).toBe("private_user_data");
    expect(safe).not.toHaveProperty("catalogVersion");
    expect(safe).not.toHaveProperty("words");
    expect(safe.containsLocalAttachmentData).toBe(false);
    expect(safe.records[0].attachments[0].localDataUrl).toBeUndefined();
    expect(safe.records[0].ocr?.rawText).toBeUndefined();
    expect(safe.records[0].source.localLocator).toBeUndefined();
    expect(json).not.toContain("data:image");
    expect(json).not.toContain("/private/mock-3.pdf");

    const privateBackup = createSafeMockMistakeExport([record], NOW, {
      includeLocalAttachmentData: true,
      includeRawOcrText: true,
      includeLocalLocators: true,
    });
    expect(privateBackup.records[0].attachments[0].localDataUrl).toContain("data:image/png");
    expect(privateBackup.records[0].ocr?.rawText).toContain("anything but");
    expect(privateBackup.records[0].source.localLocator).toContain("mock-3.pdf");
  });
});
