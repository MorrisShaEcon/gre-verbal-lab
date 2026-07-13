/**
 * Private GRE question injection boundary.
 *
 * Source text enters the personal catalog only after a human binds an exact
 * question to an exact sense. The public builder must call
 * stripPrivateGreQuestionFields before serializing a sense.
 */

const SENSE_MATCH_STATES = new Set(["confirmed_sense", "word_form_only", "rejected"]);
const QUESTION_TYPES = new Set([
  "text_completion",
  "sentence_equivalence",
  "reading_multiple_choice",
  "reading_select_all",
  "reading_sentence_selection",
]);
const PRIORITY = { confirmed_sense: 0, word_form_only: 1, rejected: 2 };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clean(value) {
  return String(value ?? "").trim();
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validPageRange(item, label, pageCount) {
  assert(Number.isInteger(item.pageStart) && item.pageStart > 0, `${label}: pageStart must be a positive integer`);
  assert(Number.isInteger(item.pageEnd) && item.pageEnd >= item.pageStart, `${label}: pageEnd must not precede pageStart`);
  assert(!pageCount || item.pageEnd <= pageCount, `${label}: page range exceeds source page count`);
}

function normalizedText(value) {
  return clean(value).toLowerCase().replaceAll("’", "'");
}

function escapedRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function exactHeadwordLocations(question, passage, headword) {
  const normalizedHeadword = normalizedText(headword);
  if (!normalizedHeadword) return [];
  const pattern = new RegExp(`(?<![A-Za-z])${escapedRegExp(normalizedHeadword)}(?![A-Za-z])`, "i");
  const fields = [
    ["passage", passage?.text ?? ""],
    ["stem", question.stem ?? ""],
    ...(question.options ?? []).map((option) => [`option:${option.label}`, option.text]),
  ];
  return fields.filter(([, text]) => pattern.test(normalizedText(text))).map(([location]) => location);
}

function bindingEntries(reviewBindings) {
  if (!reviewBindings) return {};
  assert(isObject(reviewBindings), "GRE sense bindings must be an object");
  if ("schemaVersion" in reviewBindings) {
    assert(reviewBindings.schemaVersion === 1, "GRE sense bindings schemaVersion must be 1");
    const entries = reviewBindings.entries ?? reviewBindings.bindings;
    assert(isObject(entries), "GRE sense bindings need an entries object");
    return entries;
  }
  return reviewBindings;
}

function requireReviewedBindingsWhenCorpusExists(corpus, reviewBindings, required) {
  if (!corpus && reviewBindings) {
    throw new Error("GRE sense bindings exist but the private GRE corpus is missing");
  }
  if (!corpus || !required) return;
  assert(reviewBindings, "Private GRE corpus exists, but reviewed sense bindings are missing; refusing a full personal build");
  const entries = bindingEntries(reviewBindings);
  assert(Object.keys(entries).length > 0, "Private GRE corpus exists, but reviewed sense bindings are empty; refusing a full personal build");
}

function sourceMapFrom(corpus) {
  assert(corpus.schemaVersion === 1, "Private GRE corpus schemaVersion must be 1");
  assert(corpus.privacy?.classification === "private_local_material", "Private GRE corpus lacks private classification");
  assert(corpus.privacy?.distribution === "do_not_publish", "Private GRE corpus lacks do-not-publish policy");
  assert(Array.isArray(corpus.sources), "Private GRE corpus needs sources[]");
  assert(Array.isArray(corpus.questions), "Private GRE corpus needs questions[]");
  assert(Array.isArray(corpus.passages), "Private GRE corpus needs passages[]");
  assert(isObject(corpus.indexes?.headwords), "Private GRE corpus needs indexes.headwords");
  const sources = new Map();
  for (const source of corpus.sources) {
    assert(clean(source.id), "Private GRE corpus source is missing id");
    assert(!sources.has(source.id), `Private GRE corpus repeats source ${source.id}`);
    assert(clean(source.path) && !source.path.startsWith("/") && !source.path.split(/[\\/]/).includes(".."), `${source.id}: source path must be relative`);
    assert(Number.isInteger(source.pageCount) && source.pageCount > 0, `${source.id}: source pageCount must be positive`);
    sources.set(source.id, source);
  }
  return sources;
}

function validateOptionsAndAnswer(question, displayable) {
  assert(QUESTION_TYPES.has(question.questionType), `${question.id}: unsupported question type ${question.questionType}`);
  assert(clean(question.stem), `${question.id}: question stem is empty`);
  assert(Array.isArray(question.options), `${question.id}: options must be an array`);
  const labels = new Set();
  for (const option of question.options) {
    assert(/^[A-I]$/.test(option.label ?? ""), `${question.id}: invalid option label`);
    assert(!labels.has(option.label), `${question.id}: duplicate option ${option.label}`);
    assert(clean(option.text), `${question.id}: option ${option.label} is empty`);
    labels.add(option.label);
  }
  if (!displayable) return;
  if (question.questionType !== "reading_sentence_selection") {
    assert(question.options.length >= 2, `${question.id}: displayable private question needs at least two options`);
  }
  assert(isObject(question.answer), `${question.id}: structured answer is missing`);
  if (question.answer.kind === "option_labels") {
    assert(Array.isArray(question.answer.values) && question.answer.values.length > 0, `${question.id}: answer labels are empty`);
    assert(question.answer.values.every((label) => labels.has(label)), `${question.id}: answer references a missing option`);
  } else if (question.answer.kind === "sentence_reference") {
    assert(clean(question.answer.value), `${question.id}: sentence reference answer is empty`);
  } else {
    throw new Error(`${question.id}: unsupported or missing answer kind`);
  }
  assert(["high", "medium"].includes(question.parseConfidence), `${question.id}: extraction still requires structural review`);
  assert(Array.isArray(question.anomalies) && question.anomalies.length === 0, `${question.id}: unresolved extraction anomalies: ${(question.anomalies ?? []).join(", ")}`);
}

function validatedQuestion(question, sources, passages, displayable) {
  assert(clean(question.id), "Private GRE question is missing id");
  const source = sources.get(question.sourceId);
  assert(source, `${question.id}: source ${question.sourceId} is not declared`);
  assert(source.role === "question_bank", `${question.id}: source is not a question bank`);
  assert(question.sourceFile === source.path, `${question.id}: sourceFile does not match source path`);
  validPageRange(question, question.id, source.pageCount);
  assert(Number.isInteger(question.questionNumber) && question.questionNumber > 0, `${question.id}: questionNumber must be positive`);
  validateOptionsAndAnswer(question, displayable);

  const contextId = clean(question.contextId ?? question.passageId);
  const passage = contextId ? passages.get(contextId) : undefined;
  if (contextId) {
    assert(passage, `${question.id}: passage/context ${contextId} is missing`);
    assert(passage.sourceId === question.sourceId, `${question.id}: passage source differs from question source`);
    assert(passage.sourceFile === question.sourceFile, `${question.id}: passage sourceFile differs from question sourceFile`);
    validPageRange(passage, contextId, source.pageCount);
    assert(clean(passage.text), `${question.id}: passage text is empty`);
  } else {
    assert(!question.questionType.startsWith("reading_"), `${question.id}: reading question has no passage/context id`);
  }
  return { source, passage, contextId: contextId || null };
}

function normalizedLocations(indexMatch, question, passage, headword) {
  assert(["exact_word_form", "inflected_form_candidate"].includes(indexMatch?.matchType), `${question.id}: unsupported corpus index match type`);
  const expectedSenseStatus = indexMatch.matchType === "exact_word_form" ? "word_form_only" : "pending_manual_review";
  assert(indexMatch?.senseStatus === expectedSenseStatus, `${question.id}: corpus index has an unsafe pre-review sense status`);
  assert(Array.isArray(indexMatch.locations) && indexMatch.locations.length > 0, `${question.id}: indexed match has no locations`);
  const allowed = new Set(["passage", "stem", ...(question.options ?? []).map((option) => `option:${option.label}`)]);
  assert(indexMatch.locations.every((location) => allowed.has(location)), `${question.id}: indexed match contains an invalid location`);
  const matchedSurface = clean(indexMatch.matchedSurface) || headword;
  if (indexMatch.matchType === "exact_word_form") {
    assert(normalizedText(matchedSurface) === normalizedText(headword), `${question.id}: exact match surface differs from the headword`);
  } else {
    assert(normalizedText(matchedSurface) !== normalizedText(headword), `${question.id}: inflection candidate must differ from the headword`);
  }
  const actual = [...new Set(exactHeadwordLocations(question, passage, matchedSurface))].sort();
  const indexed = [...new Set(indexMatch.locations)].sort();
  assert(actual.length > 0, `${question.id}: matched surface ${matchedSurface} does not occur at an exact indexed location`);
  assert(JSON.stringify(actual) === JSON.stringify(indexed), `${question.id}: indexed locations do not match source text (${indexed.join(", ")} vs ${actual.join(", ")})`);
  return { locations: actual, matchedSurface };
}

function structuredMatch(question, passage, binding, locations, matchedSurface) {
  const locator = Number.isInteger(question.section)
    ? `Section ${question.section} · Q${question.questionNumber}`
    : Number.isInteger(question.passageNumber)
      ? `Passage ${question.passageNumber} · Q${question.questionNumber}`
      : `Q${question.questionNumber}`;
  return {
    id: question.id,
    sourceLabel: "本地 GRE 机经题库",
    sourceFile: question.sourceFile,
    pageStart: question.pageStart,
    pageEnd: question.pageEnd,
    locator,
    questionType: question.questionType,
    ...(passage ? { passageText: passage.text } : {}),
    questionText: question.stem,
    options: question.options.map((option) => ({ label: option.label, text: option.text })),
    answerValues: question.answer.kind === "option_labels"
      ? [...question.answer.values]
      : [question.answer.value],
    matchedSurface,
    matchLocations: locations,
    senseMatchState: binding.senseMatchState,
    reviewNote: clean(binding.reviewNote),
  };
}

export function stripPrivateGreQuestionFields(sense) {
  const {
    greQuestionMatches: _greQuestionMatches,
    greQuestionMatchStats: _greQuestionMatchStats,
    ...safeSense
  } = sense;
  return safeSense;
}

export function privateGreQuestionLeakReasons(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const checks = [
    ["greQuestionMatches field", /"greQuestionMatches"/i],
    ["greQuestionMatchStats field", /"greQuestionMatchStats"/i],
    ["greQuestionCorpusStats field", /"greQuestionCorpusStats"/i],
    ["private corpus policy", /private_local_material|do_not_publish/i],
    ["structured private question text", /"questionText"\s*:/i],
    ["structured private source locator", /"sourceFile"\s*:/i],
    ["structured private match locator", /"matchLocations"\s*:/i],
  ];
  return checks.filter(([, pattern]) => pattern.test(serialized)).map(([label]) => label);
}

export function assertNoPrivateGreQuestionLeak(value, label = "public catalog") {
  const reasons = privateGreQuestionLeakReasons(value);
  assert(reasons.length === 0, `${label} contains private GRE question data: ${reasons.join(", ")}`);
}

function emptyReport() {
  return {
    enabled: false,
    corpusQuestions: 0,
    corpusPassages: 0,
    reviewedBindings: 0,
    confirmedSenseBindings: 0,
    wordFormOnlyBindings: 0,
    rejectedBindings: 0,
    selectedMatches: 0,
    omittedByLimit: 0,
    sensesWithMatches: 0,
  };
}

/**
 * Returns cloned words and aggregate statistics. `maxPerSense` limits copied
 * source text, while per-sense and aggregate counts retain the full reviewed
 * binding totals.
 */
export function injectPrivateGreQuestionMatches(words, corpus, reviewBindings, options = {}) {
  assert(Array.isArray(words), "Personal catalog words must be an array");
  const maxPerSense = options.maxPerSense ?? 3;
  assert(Number.isInteger(maxPerSense) && maxPerSense >= 1 && maxPerSense <= 10, "maxPerSense must be an integer from 1 to 10");
  const cleanWords = words.map((word) => ({
    ...word,
    senses: (word.senses ?? []).map(stripPrivateGreQuestionFields),
  }));
  const requireReviewedBindings = options.requireReviewedBindings === true;
  requireReviewedBindingsWhenCorpusExists(corpus, reviewBindings, requireReviewedBindings);
  if (!corpus) return { words: cleanWords, report: emptyReport() };

  const entries = bindingEntries(reviewBindings);
  const sources = sourceMapFrom(corpus);
  const questions = new Map();
  for (const question of corpus.questions) {
    assert(clean(question.id), "Private GRE corpus question is missing id");
    assert(!questions.has(question.id), `Private GRE corpus repeats question ${question.id}`);
    questions.set(question.id, question);
  }
  const passages = new Map();
  for (const passage of corpus.passages) {
    assert(clean(passage.id), "Private GRE corpus passage is missing id");
    assert(!passages.has(passage.id), `Private GRE corpus repeats passage ${passage.id}`);
    passages.set(passage.id, passage);
  }
  const senseItems = new Map(cleanWords.flatMap((word) => word.senses.map((sense) => [sense.id, { word, sense }])));
  const confirmedByWordQuestion = new Map();
  const matchesBySense = new Map();
  const statsBySense = new Map();
  const report = {
    ...emptyReport(),
    enabled: true,
    corpusQuestions: questions.size,
    corpusPassages: passages.size,
  };

  for (const { word, sense } of senseItems.values()) {
    const headwordMatches = corpus.indexes.headwords[word.normalizedHeadword] ?? [];
    const candidateQuestionIds = new Set(headwordMatches.map((match) => match.questionId));
    const exactQuestionIds = new Set(headwordMatches
      .filter((match) => match.matchType === "exact_word_form")
      .map((match) => match.questionId));
    const inflectionQuestionIds = new Set(headwordMatches
      .filter((match) => match.matchType === "inflected_form_candidate")
      .map((match) => match.questionId));
    statsBySense.set(sense.id, {
      corpusReviewState: candidateQuestionIds.size ? "pending_review" : "scanned_no_candidate",
      availableCorpusWordFormMatches: candidateQuestionIds.size,
      exactCorpusMatches: exactQuestionIds.size,
      inflectionCandidates: inflectionQuestionIds.size,
      reviewedBindings: 0,
      unreviewedCandidates: candidateQuestionIds.size,
      confirmedSenseBindings: 0,
      wordFormOnlyBindings: 0,
      rejectedBindings: 0,
      selectedMatches: 0,
      omittedByLimit: 0,
    });
    matchesBySense.set(sense.id, []);
  }

  for (const [senseId, rawBindings] of Object.entries(entries)) {
    const item = senseItems.get(senseId);
    assert(item, `GRE question binding references missing sense ${senseId}`);
    assert(Array.isArray(rawBindings), `${senseId}: bindings must be an array`);
    const seenQuestionIds = new Set();
    const reviewed = [];
    const headwordMatches = corpus.indexes.headwords[item.word.normalizedHeadword] ?? [];
    for (const binding of rawBindings) {
      assert(isObject(binding), `${senseId}: binding must be an object`);
      assert(clean(binding.questionId), `${senseId}: binding is missing questionId`);
      assert(!seenQuestionIds.has(binding.questionId), `${senseId}: duplicate binding for ${binding.questionId}`);
      seenQuestionIds.add(binding.questionId);
      assert(SENSE_MATCH_STATES.has(binding.senseMatchState), `${senseId}/${binding.questionId}: invalid senseMatchState`);
      assert(clean(binding.reviewNote), `${senseId}/${binding.questionId}: manual review note is required`);
      const question = questions.get(binding.questionId);
      assert(question, `${senseId}: question ${binding.questionId} is absent from corpus`);
      const displayable = binding.senseMatchState !== "rejected";
      const { passage } = validatedQuestion(question, sources, passages, displayable);
      const indexMatch = headwordMatches
        .filter((match) => match.questionId === question.id)
        .sort((left, right) => (left.matchType === "exact_word_form" ? 0 : 1) - (right.matchType === "exact_word_form" ? 0 : 1))[0];
      assert(indexMatch, `${senseId}/${question.id}: no exact headword index entry for ${item.word.normalizedHeadword}`);
      const { locations, matchedSurface } = normalizedLocations(indexMatch, question, passage, item.word.normalizedHeadword);

      if (binding.senseMatchState === "confirmed_sense") {
        const key = `${item.word.id}|${question.id}`;
        const previous = confirmedByWordQuestion.get(key);
        assert(!previous || previous === senseId, `${question.id}: the same headword is confirmed against multiple senses`);
        confirmedByWordQuestion.set(key, senseId);
      }
      reviewed.push({
        binding,
        match: displayable
          ? structuredMatch(question, passage, binding, locations, matchedSurface)
          : null,
      });
    }

    const selectable = reviewed
      .filter(({ binding }) => binding.senseMatchState !== "rejected")
      .sort((left, right) => PRIORITY[left.binding.senseMatchState] - PRIORITY[right.binding.senseMatchState]
        || left.match.id.localeCompare(right.match.id));
    const selected = selectable.slice(0, maxPerSense).map(({ match }) => match);
    const previousStats = statsBySense.get(senseId);
    const reviewedQuestionIds = new Set(reviewed.map(({ binding }) => binding.questionId));
    const counts = {
      ...previousStats,
      corpusReviewState: previousStats.availableCorpusWordFormMatches > reviewedQuestionIds.size
        ? "pending_review"
        : "reviewed",
      reviewedBindings: reviewed.length,
      unreviewedCandidates: Math.max(0, previousStats.availableCorpusWordFormMatches - reviewedQuestionIds.size),
      confirmedSenseBindings: reviewed.filter(({ binding }) => binding.senseMatchState === "confirmed_sense").length,
      wordFormOnlyBindings: reviewed.filter(({ binding }) => binding.senseMatchState === "word_form_only").length,
      rejectedBindings: reviewed.filter(({ binding }) => binding.senseMatchState === "rejected").length,
      selectedMatches: selected.length,
      omittedByLimit: Math.max(0, selectable.length - selected.length),
    };
    matchesBySense.set(senseId, selected);
    statsBySense.set(senseId, counts);
    report.reviewedBindings += counts.reviewedBindings;
    report.confirmedSenseBindings += counts.confirmedSenseBindings;
    report.wordFormOnlyBindings += counts.wordFormOnlyBindings;
    report.rejectedBindings += counts.rejectedBindings;
    report.selectedMatches += counts.selectedMatches;
    report.omittedByLimit += counts.omittedByLimit;
    if (selected.length) report.sensesWithMatches += 1;
  }

  if (requireReviewedBindings) {
    assert(report.reviewedBindings > 0, "Private GRE corpus review produced zero bindings; refusing a full personal build");
  }

  return {
    words: cleanWords.map((word) => ({
      ...word,
      senses: word.senses.map((sense) => {
        return {
          ...sense,
          ...(matchesBySense.get(sense.id)?.length ? { greQuestionMatches: matchesBySense.get(sense.id) } : {}),
          greQuestionMatchStats: statsBySense.get(sense.id),
        };
      }),
    })),
    report,
  };
}
