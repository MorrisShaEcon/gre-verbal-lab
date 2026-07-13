import { describe, expect, it } from "vitest";
import {
  assertNoPrivateGreQuestionLeak,
  exactHeadwordLocations,
  injectPrivateGreQuestionMatches,
  privateGreQuestionLeakReasons,
  stripPrivateGreQuestionFields,
} from "./private-gre-question-injection.mjs";
import { greQuestionMatchesFor } from "../../src/scheduler.ts";

function optionQuestion(id, page, stem) {
  return {
    id,
    sourceId: "fixture-fill-bank",
    sourceFile: "fixtures/fill-bank.pdf",
    pageStart: page,
    pageEnd: page,
    section: 1,
    sectionDifficulty: "easy",
    questionNumber: page,
    questionType: "text_completion",
    blankCount: 1,
    stem,
    options: [
      { label: "A", text: "clear" },
      { label: "B", text: "obscure" },
      { label: "C", text: "lengthy" },
      { label: "D", text: "tentative" },
      { label: "E", text: "ornate" },
    ],
    answer: { kind: "option_labels", values: ["A"] },
    parseConfidence: "high",
    anomalies: [],
  };
}

function fixture() {
  const questions = [
    optionQuestion("fixture-fill-q01", 10, "The lucid response reassured the committee."),
    optionQuestion("fixture-fill-q02", 11, "Her lucid argument resolved the dispute."),
    optionQuestion("fixture-fill-q04", 12, "A lucid summary followed the report."),
    {
      id: "fixture-a-read-q01",
      sourceId: "fixture-reading-bank",
      sourceFile: "fixtures/reading-bank.pdf",
      pageStart: 20,
      pageEnd: 20,
      passageId: "gre-rc-p001",
      passageNumber: 1,
      questionNumber: 1,
      questionType: "reading_multiple_choice",
      stem: "Which statement best expresses the author's main point?",
      options: [
        { label: "A", text: "The account is complete." },
        { label: "B", text: "The account is contested." },
        { label: "C", text: "The account is irrelevant." },
        { label: "D", text: "The account is derivative." },
        { label: "E", text: "The account is predictive." },
      ],
      answer: { kind: "option_labels", values: ["B"] },
      parseConfidence: "medium",
      anomalies: [],
    },
  ];
  const passages = [{
    id: "gre-rc-p001",
    sourceId: "fixture-reading-bank",
    sourceFile: "fixtures/reading-bank.pdf",
    passageNumber: 1,
    pageStart: 19,
    pageEnd: 20,
    text: "The initially lucid account became contested when new evidence appeared.",
  }];
  return {
    words: [{
      id: "word-lucid",
      normalizedHeadword: "lucid",
      senses: [{ id: "sense-lucid-clear", definitionZh: "清晰易懂的" }],
    }],
    corpus: {
      schemaVersion: 1,
      privacy: { classification: "private_local_material", distribution: "do_not_publish" },
      sources: [
        { id: "fixture-fill-bank", role: "question_bank", path: "fixtures/fill-bank.pdf", pageCount: 100 },
        { id: "fixture-reading-bank", role: "question_bank", path: "fixtures/reading-bank.pdf", pageCount: 100 },
      ],
      passages,
      questions,
      indexes: {
        headwords: {
          lucid: [
            ...questions.slice(0, 3).map((question) => ({
              questionId: question.id,
              locations: ["stem"],
              matchType: "exact_word_form",
              senseStatus: "word_form_only",
            })),
            {
              questionId: "fixture-a-read-q01",
              locations: ["passage"],
              matchType: "exact_word_form",
              senseStatus: "word_form_only",
            },
          ],
        },
      },
    },
    bindings: {
      schemaVersion: 1,
      entries: {
        "sense-lucid-clear": [
          { questionId: "fixture-fill-q01", senseMatchState: "word_form_only", reviewNote: "Exact form found; sense still needs confirmation." },
          { questionId: "fixture-fill-q02", senseMatchState: "confirmed_sense", reviewNote: "Lucid means clear and easy to understand here." },
          { questionId: "fixture-a-read-q01", senseMatchState: "word_form_only", reviewNote: "Passage occurrence retained as a review candidate." },
          { questionId: "fixture-fill-q04", senseMatchState: "rejected", reviewNote: "Rejected during semantic review." },
        ],
      },
    },
  };
}

describe("private GRE question injection", () => {
  it("injects confirmed matches first, limits copied source text, and retains complete counts", () => {
    const { words, corpus, bindings } = fixture();
    const result = injectPrivateGreQuestionMatches(words, corpus, bindings, { maxPerSense: 2 });
    const sense = result.words[0].senses[0];

    expect(words[0].senses[0]).not.toHaveProperty("greQuestionMatches");
    expect(sense.greQuestionMatches.map((match) => match.id)).toEqual([
      "fixture-fill-q02",
      "fixture-a-read-q01",
    ]);
    expect(sense.greQuestionMatches[0]).toMatchObject({
      id: "fixture-fill-q02",
      sourceLabel: "本地 GRE 机经题库",
      sourceFile: "fixtures/fill-bank.pdf",
      pageStart: 11,
      pageEnd: 11,
      locator: "Section 1 · Q11",
      questionType: "text_completion",
      questionText: "Her lucid argument resolved the dispute.",
      answerValues: ["A"],
      matchedSurface: "lucid",
      senseMatchState: "confirmed_sense",
      matchLocations: ["stem"],
    });
    expect(sense.greQuestionMatches[1]).toMatchObject({
      id: "fixture-a-read-q01",
      locator: "Passage 1 · Q1",
      questionType: "reading_multiple_choice",
      matchLocations: ["passage"],
    });
    expect(sense.greQuestionMatches[1].passageText).toContain("lucid account");
    expect(greQuestionMatchesFor(sense).map((match) => match.id)).toEqual([
      "fixture-fill-q02",
      "fixture-a-read-q01",
    ]);
    expect(sense.greQuestionMatchStats).toEqual({
      corpusReviewState: "reviewed",
      availableCorpusWordFormMatches: 4,
      exactCorpusMatches: 4,
      inflectionCandidates: 0,
      reviewedBindings: 4,
      unreviewedCandidates: 0,
      confirmedSenseBindings: 1,
      wordFormOnlyBindings: 2,
      rejectedBindings: 1,
      selectedMatches: 2,
      omittedByLimit: 1,
    });
    expect(result.report).toMatchObject({
      enabled: true,
      reviewedBindings: 4,
      selectedMatches: 2,
      omittedByLimit: 1,
      sensesWithMatches: 1,
    });
  });

  it("accepts plain senseId maps and harmlessly clears stale private fields when inputs are absent", () => {
    const { words, corpus, bindings } = fixture();
    const plain = injectPrivateGreQuestionMatches(words, corpus, bindings.entries, { maxPerSense: 3 });
    expect(plain.words[0].senses[0].greQuestionMatches).toHaveLength(3);

    const stale = structuredClone(words);
    stale[0].senses[0].greQuestionMatches = [{ questionId: "stale" }];
    stale[0].senses[0].greQuestionMatchStats = { selectedMatches: 1 };
    const missing = injectPrivateGreQuestionMatches(stale, null, null);
    expect(missing.report.enabled).toBe(false);
    expect(missing.words[0].senses[0]).not.toHaveProperty("greQuestionMatches");
    expect(missing.words[0].senses[0]).not.toHaveProperty("greQuestionMatchStats");
  });

  it("fails closed for a full personal build when a present corpus has missing or empty review bindings", () => {
    const { words, corpus } = fixture();
    expect(() => injectPrivateGreQuestionMatches(words, corpus, null, {
      requireReviewedBindings: true,
    })).toThrow(/reviewed sense bindings are missing/);
    expect(() => injectPrivateGreQuestionMatches(words, corpus, { schemaVersion: 1, entries: {} }, {
      requireReviewedBindings: true,
    })).toThrow(/reviewed sense bindings are empty/);
  });

  it("retains a scan state for every sense, including pending candidates and scanned misses", () => {
    const base = fixture();
    base.words[0].senses.push({ id: "sense-lucid-figurative", definitionZh: "明白的" });
    base.words.push({
      id: "word-absent",
      normalizedHeadword: "absent",
      senses: [{ id: "sense-absent", definitionZh: "缺席的" }],
    });
    const result = injectPrivateGreQuestionMatches(base.words, base.corpus, base.bindings);
    expect(result.words[0].senses[1].greQuestionMatchStats).toMatchObject({
      corpusReviewState: "pending_review",
      availableCorpusWordFormMatches: 4,
      reviewedBindings: 0,
      unreviewedCandidates: 4,
      selectedMatches: 0,
    });
    expect(result.words[1].senses[0].greQuestionMatchStats).toMatchObject({
      corpusReviewState: "scanned_no_candidate",
      availableCorpusWordFormMatches: 0,
      reviewedBindings: 0,
      unreviewedCandidates: 0,
      selectedMatches: 0,
    });
    expect(result.words[0].senses[1]).not.toHaveProperty("greQuestionMatches");
  });

  it("keeps inflected-form hits pending until a human binds the sense", () => {
    const base = fixture();
    const question = optionQuestion("fixture-fill-q01", 10, "The group amassed substantial evidence.");
    base.words = [{
      id: "word-amass",
      normalizedHeadword: "amass",
      senses: [{ id: "sense-amass", definitionZh: "积累" }],
    }];
    base.corpus.questions = [question];
    base.corpus.passages = [];
    base.corpus.sources = [base.corpus.sources[0]];
    base.corpus.indexes.headwords = {
      amass: [{
        questionId: question.id,
        locations: ["stem"],
        matchedSurface: "amassed",
        matchType: "inflected_form_candidate",
        senseStatus: "pending_manual_review",
      }],
    };
    const pending = injectPrivateGreQuestionMatches(base.words, base.corpus, null);
    expect(pending.words[0].senses[0].greQuestionMatchStats).toMatchObject({
      corpusReviewState: "pending_review",
      exactCorpusMatches: 0,
      inflectionCandidates: 1,
      reviewedBindings: 0,
    });
    expect(pending.words[0].senses[0]).not.toHaveProperty("greQuestionMatches");

    const reviewed = injectPrivateGreQuestionMatches(base.words, base.corpus, {
      schemaVersion: 1,
      entries: {
        "sense-amass": [{
          questionId: question.id,
          senseMatchState: "word_form_only",
          reviewNote: "A human confirmed that amassed is the inflected surface of amass in this question.",
        }],
      },
    });
    expect(reviewed.words[0].senses[0].greQuestionMatches[0]).toMatchObject({
      matchedSurface: "amassed",
      senseMatchState: "word_form_only",
    });
  });

  it("recomputes exact stem, option, and passage positions instead of trusting an index blindly", () => {
    const { corpus } = fixture();
    const question = optionQuestion("test", 1, "A lucid but brief answer used the term elsewhere.");
    question.options[2].text = "another lucid explanation";
    expect(exactHeadwordLocations(question, { text: "The passage is lucid." }, "lucid")).toEqual([
      "passage",
      "stem",
      "option:C",
    ]);

    corpus.indexes.headwords.lucid[0].locations = ["option:A"];
    expect(() => injectPrivateGreQuestionMatches(fixture().words, corpus, fixture().bindings)).toThrow(/indexed locations do not match source text/);
  });

  it("rejects missing sources, impossible pages, broken options, unknown senses and unresolved parses", () => {
    const base = fixture();
    const badPage = structuredClone(base.corpus);
    badPage.questions[0].pageEnd = 101;
    expect(() => injectPrivateGreQuestionMatches(base.words, badPage, base.bindings)).toThrow(/page range exceeds source page count/);

    const badAnswer = structuredClone(base.corpus);
    badAnswer.questions[0].answer.values = ["Z"];
    expect(() => injectPrivateGreQuestionMatches(base.words, badAnswer, base.bindings)).toThrow(/answer references a missing option/);

    const badParse = structuredClone(base.corpus);
    badParse.questions[0].parseConfidence = "review";
    expect(() => injectPrivateGreQuestionMatches(base.words, badParse, base.bindings)).toThrow(/requires structural review/);

    const unknownSense = { schemaVersion: 1, entries: { "sense-missing": base.bindings.entries["sense-lucid-clear"] } };
    expect(() => injectPrivateGreQuestionMatches(base.words, base.corpus, unknownSense)).toThrow(/missing sense/);
  });

  it("keeps rejected-review statistics without trying to display an unresolved parsed answer", () => {
    const base = fixture();
    const rejectedQuestion = base.corpus.questions.find((question) => question.id === "fixture-fill-q04");
    rejectedQuestion.parseConfidence = "review";
    rejectedQuestion.answer = { kind: "unknown" };
    rejectedQuestion.anomalies = ["missing_answer"];

    const result = injectPrivateGreQuestionMatches(base.words, base.corpus, base.bindings, { maxPerSense: 3 });
    expect(result.report.rejectedBindings).toBe(1);
    expect(result.words[0].senses[0].greQuestionMatches.map((match) => match.id)).not.toContain("fixture-fill-q04");
  });

  it("keeps sentence-reference answers for reading sentence-selection questions with no options", () => {
    const base = fixture();
    const reading = base.corpus.questions.find((question) => question.id === "fixture-a-read-q01");
    reading.questionType = "reading_sentence_selection";
    reading.options = [];
    reading.answer = { kind: "sentence_reference", value: "The initially lucid account became contested." };
    base.bindings.entries["sense-lucid-clear"] = [{
      questionId: reading.id,
      senseMatchState: "confirmed_sense",
      reviewNote: "The passage uses lucid in the reviewed clear-sense meaning.",
    }];

    const sense = injectPrivateGreQuestionMatches(base.words, base.corpus, base.bindings).words[0].senses[0];
    expect(sense.greQuestionMatches[0]).toMatchObject({
      questionType: "reading_sentence_selection",
      options: [],
      answerValues: ["The initially lucid account became contested."],
    });
    expect(greQuestionMatchesFor(sense)).toHaveLength(1);
  });

  it("strips private question fields and detects any serialized regression", () => {
    const { words, corpus, bindings } = fixture();
    const privateSense = injectPrivateGreQuestionMatches(words, corpus, bindings).words[0].senses[0];
    const publicSense = stripPrivateGreQuestionFields(privateSense);
    expect(publicSense).not.toHaveProperty("greQuestionMatches");
    expect(publicSense).not.toHaveProperty("greQuestionMatchStats");
    expect(privateGreQuestionLeakReasons({ words: [{ senses: [privateSense] }] })).toContain("greQuestionMatches field");
    expect(() => assertNoPrivateGreQuestionLeak({ words: [{ senses: [privateSense] }] })).toThrow(/private GRE question data/);
    expect(() => assertNoPrivateGreQuestionLeak({ words: [{ senses: [publicSense] }] })).not.toThrow();
  });
});
