import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isQuizTargetSense } from "../src/scheduler.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const privateDir = path.join(root, "imports/private");
const catalogPath = path.join(root, "public/data/catalog.personal.json");
const corpusPath = path.join(privateDir, "gre-question-corpus.json");
const tag = process.argv.find((argument) => argument.startsWith("--tag="))?.slice("--tag=".length).replace(/[^a-z0-9_-]/gi, "") ?? "";
const deltaFrom = process.argv.find((argument) => argument.startsWith("--delta-from="))?.slice("--delta-from=".length) ?? "";
const tagged = tag ? `-${tag}` : "";
const outputPath = path.join(privateDir, `gre-question-review-candidates${tagged}.json`);
const MAX_REVIEWED_QUESTIONS_PER_SENSE = 2;

const [catalog, corpus] = await Promise.all([
  fs.readFile(catalogPath, "utf8").then(JSON.parse),
  fs.readFile(corpusPath, "utf8").then(JSON.parse),
]);

const questionsById = new Map(corpus.questions.map((question) => [question.id, question]));
const passagesById = new Map(corpus.passages.map((passage) => [passage.id, passage]));
const confidenceRank = { high: 0, medium: 1, review: 2 };

function isAnswerOccurrence(question, locations) {
  const answers = new Set(question.answer?.values ?? []);
  return locations.some((location) => {
    const label = location.match(/^option:([A-H])$/)?.[1];
    return Boolean(label && answers.has(label));
  });
}

function candidateRank(candidate) {
  const locations = candidate.match.locations;
  const contextual = locations.some((location) => location === "stem" || location === "passage");
  const answerOccurrence = isAnswerOccurrence(candidate.question, locations);
  return [
    candidate.match.matchType === "exact_word_form" ? 0 : 1,
    contextual ? 0 : answerOccurrence ? 1 : 2,
    confidenceRank[candidate.question.parseConfidence] ?? 3,
    candidate.question.anomalies?.length ?? 0,
    candidate.question.id,
  ];
}

function compareRank(left, right) {
  const leftRank = candidateRank(left);
  const rightRank = candidateRank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] < rightRank[index]) return -1;
    if (leftRank[index] > rightRank[index]) return 1;
  }
  return 0;
}

const formalTargets = catalog.words.flatMap((word) => word.senses
  .filter((sense) => isQuizTargetSense(word, sense))
  .map((sense) => ({ word, sense })));

const entries = formalTargets.map(({ word, sense }) => {
  const indexedMatches = corpus.indexes?.headwords?.[word.normalizedHeadword] ?? [];
  const allCandidates = indexedMatches.flatMap((match) => {
    const question = questionsById.get(match.questionId);
    if (!question) return [];
    const passage = question.passageId ? passagesById.get(question.passageId) : undefined;
    return [{
      match,
      question,
      passageText: passage?.text ?? "",
      isAnswerOccurrence: isAnswerOccurrence(question, match.locations),
    }];
  }).sort(compareRank);
  return {
    headword: word.headword,
    normalizedHeadword: word.normalizedHeadword,
    wordId: word.id,
    senseId: sense.id,
    partOfSpeech: sense.partOfSpeech,
    definitionZh: sense.definitionZh,
    definitionEn: sense.definitionEn,
    openSenseId: sense.openSenseId,
    exactMatchCount: allCandidates.filter((candidate) => candidate.match.matchType === "exact_word_form").length,
    inflectionCandidateCount: allCandidates.filter((candidate) => candidate.match.matchType === "inflected_form_candidate").length,
    indexedCandidateCount: allCandidates.length,
    selectedCandidateCount: Math.min(MAX_REVIEWED_QUESTIONS_PER_SENSE, allCandidates.length),
    candidates: allCandidates.slice(0, MAX_REVIEWED_QUESTIONS_PER_SENSE),
  };
});

const matchedEntries = entries.filter((entry) => entry.candidates.length > 0);
const unmatchedEntries = entries.filter((entry) => entry.candidates.length === 0);
const envelope = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  privacy: "private_user_held_question_text",
  method: "Exact surface forms are always ranked before conservative regular-inflection candidates; both then rank by contextual occurrence, answer occurrence, parse confidence, and anomaly count. Every candidate requires human sense review.",
  selectionLimitPerSense: MAX_REVIEWED_QUESTIONS_PER_SENSE,
  counts: {
    formalTargets: entries.length,
    targetsWithIndexedCandidate: matchedEntries.length,
    targetsWithExactMatch: entries.filter((entry) => entry.exactMatchCount > 0).length,
    targetsWithInflectionCandidate: entries.filter((entry) => entry.inflectionCandidateCount > 0).length,
    targetsWithoutCandidate: unmatchedEntries.length,
    exactQuestionLinks: entries.reduce((sum, entry) => sum + entry.exactMatchCount, 0),
    inflectionCandidateLinks: entries.reduce((sum, entry) => sum + entry.inflectionCandidateCount, 0),
    selectedForHumanReview: matchedEntries.reduce((sum, entry) => sum + entry.selectedCandidateCount, 0),
  },
  matchedEntries,
  unmatchedEntries: unmatchedEntries.map(({ candidates: _candidates, ...entry }) => entry),
};

await fs.writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`);

const batches = [[], [], []];
const batchLoads = [0, 0, 0];
for (const entry of [...matchedEntries].sort((left, right) => right.selectedCandidateCount - left.selectedCandidateCount || left.normalizedHeadword.localeCompare(right.normalizedHeadword, "en"))) {
  const target = batchLoads.indexOf(Math.min(...batchLoads));
  batches[target].push(entry);
  batchLoads[target] += entry.selectedCandidateCount;
}
for (const [index, batch] of batches.entries()) {
  const batchPath = path.join(privateDir, `gre-question-review-batch${tagged}-${index + 1}.json`);
  await fs.writeFile(batchPath, `${JSON.stringify({
    schemaVersion: 1,
    batch: index + 1,
    reviewInstructions: {
      confirmed_sense: "Use only when the full local question context clearly uses the listed target sense.",
      word_form_only: "Use when the indexed exact or regular-inflection surface appears but the question does not establish this exact sense, including an isolated distractor option.",
      inflectionSafety: "An inflected_form_candidate is never pre-confirmed. Verify both the lemma relationship and the exact sense manually.",
      output: `Write imports/private/gre-question-bindings-batch${tagged}-${index + 1}.json with entries [{senseId, headword, questionId, senseMatchState, reviewNote}]. Review every candidate in this file.`,
    },
    entries: batch,
  }, null, 2)}\n`);
}

let deltaCount = 0;
if (deltaFrom) {
  const baselinePath = path.resolve(privateDir, deltaFrom);
  const relative = path.relative(privateDir, baselinePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refusing delta baseline outside ${privateDir}`);
  const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
  const candidateKey = (entry, candidate) => `${entry.senseId}|${candidate.question.id}|${candidate.match.matchType ?? "exact_word_form"}|${candidate.match.matchedSurface ?? entry.normalizedHeadword}`;
  const baselineKeys = new Set((baseline.matchedEntries ?? []).flatMap((entry) => entry.candidates.map((candidate) => candidateKey(entry, candidate))));
  const deltaEntries = matchedEntries.flatMap((entry) => {
    const candidates = entry.candidates.filter((candidate) => !baselineKeys.has(candidateKey(entry, candidate)));
    return candidates.length ? [{ ...entry, selectedCandidateCount: candidates.length, candidates }] : [];
  });
  deltaCount = deltaEntries.reduce((sum, entry) => sum + entry.candidates.length, 0);
  const deltaPath = path.join(privateDir, "gre-question-review-delta.json");
  await fs.writeFile(deltaPath, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseline: deltaFrom,
    reviewInstructions: {
      confirmed_sense: "Use only when the full local question context clearly uses the listed target sense.",
      word_form_only: "Use when the indexed exact or regular-inflection surface appears but the question does not establish this exact sense.",
      inflectionSafety: "An inflected_form_candidate is never pre-confirmed. Verify both the lemma relationship and the exact sense manually.",
      output: "Write imports/private/gre-question-bindings-delta.json with entries [{senseId, headword, questionId, senseMatchState, reviewNote}].",
    },
    entries: deltaEntries,
  }, null, 2)}\n`);
}

console.log(JSON.stringify({ outputPath, counts: envelope.counts, batchLoads, deltaCount }));
