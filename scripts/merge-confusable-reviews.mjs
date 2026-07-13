import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const privateDir = path.join(root, "imports/private");
const catalog = JSON.parse(await fs.readFile(path.join(root, "public/data/catalog.personal.json"), "utf8"));
const manifestPath = path.join(privateDir, "study-sense-reviews.personal.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const reviewFiles = ["a", "b", "c", "d", "e", "f"].map((suffix) => path.join(privateDir, `confusable-review-${suffix}.json`));
const reviewParts = await Promise.all(reviewFiles.map(async (file) => JSON.parse(await fs.readFile(file, "utf8"))));

const server = await createServer({ root, logLevel: "silent", appType: "custom", server: { middlewareMode: true } });
const { isQuizTargetSense, isStudyReadySense } = await server.ssrLoadModule("/src/scheduler.ts");
const {
  areDeclaredDefinitionQuizSynonyms,
  definitionQuizConceptKeys,
  definitionQuizPartOfSpeechFamily,
  definitionsAreTooClose,
} = await server.ssrLoadModule("/src/quiz.ts");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const graphReviewNotes = new Set([
  "Primary-sense semantic distractors reviewed on 2026-07-13.",
  "Formal-sense semantic distractors reviewed on 2026-07-13.",
]);
const graphReviewNote = "Formal-sense semantic distractors reviewed on 2026-07-13.";
const clean = (value) => String(value ?? "").trim();
const normalize = (value) => clean(value).toLowerCase();
const allItems = catalog.words.flatMap((word) => word.senses.map((sense) => ({ word, sense })));
const itemBySenseId = new Map(allItems.map((item) => [item.sense.id, item]));
const primaryItems = catalog.words
  .filter((word) => word.senses[0] && isStudyReadySense(word, word.senses[0]))
  .map((word) => ({ word, sense: word.senses[0] }));
const primarySenseIds = new Set(primaryItems.map(({ sense }) => sense.id));
const legacyEditorApprovedSenseIds = new Set(manifest.approvedSenseIds ?? []);
const studyReadyItems = allItems.filter(({ word, sense }) => isStudyReadySense(word, sense));
const studyReadySenseIds = new Set(studyReadyItems.map(({ sense }) => sense.id));
const quizTargetItems = studyReadyItems.filter(({ word, sense }) => isQuizTargetSense(word, sense));
const quizTargetSenseIds = new Set(quizTargetItems.map(({ sense }) => sense.id));
const entries = reviewParts.flatMap((part) => part.entries ?? []);
const conceptsOverlap = (left, right) => {
  const keys = new Set(definitionQuizConceptKeys(left));
  return definitionQuizConceptKeys(right).some((key) => keys.has(key));
};
const itemsAreCompatible = (left, right) => (
  left.word.id !== right.word.id
  && !conceptsOverlap(left.sense, right.sense)
  && !areDeclaredDefinitionQuizSynonyms(left.word, left.sense, right.word, right.sense)
  && !definitionsAreTooClose(left.sense.definitionZh, right.sense.definitionZh)
  && !(
    left.sense.definitionEn.trim()
    && right.sense.definitionEn.trim()
    && definitionsAreTooClose(left.sense.definitionEn, right.sense.definitionEn)
  )
);

assert(entries.length === quizTargetItems.length, `Expected ${quizTargetItems.length} review entries; found ${entries.length}`);
assert(new Set(entries.map((entry) => entry.targetSenseId)).size === entries.length, "Duplicate target sense in confusable review parts");
assert(entries.every((entry) => quizTargetSenseIds.has(entry.targetSenseId)), "Review parts contain a non-target formal sense");
assert(quizTargetItems.every(({ sense }) => entries.some((entry) => entry.targetSenseId === sense.id)), "A quiz-target sense is missing from the review parts");

for (const reviews of Object.values(manifest.entries ?? {})) {
  for (const review of reviews) {
    if (!studyReadySenseIds.has(review.senseId) || quizTargetSenseIds.has(review.senseId)) continue;
    delete review.confusables;
    delete review.confusableSenseIds;
    delete review.confusableRationales;
  }
}

for (const entry of entries) {
  const target = itemBySenseId.get(entry.targetSenseId);
  assert(target, `Missing target sense ${entry.targetSenseId}`);
  assert(target.word.normalizedHeadword === normalize(entry.targetHeadword), `${entry.targetHeadword}: target headword drift`);
  assert(target.sense.definitionZh === clean(entry.targetDefinitionZh), `${entry.targetHeadword}: target definition drift`);
  assert(Array.isArray(entry.candidates) && entry.candidates.length === 3, `${entry.targetHeadword}: expected exactly three candidates`);
  assert(new Set(entry.candidates.map((candidate) => candidate.senseId)).size === 3, `${entry.targetHeadword}: duplicate candidate sense`);
  assert(new Set(entry.candidates.map((candidate) => normalize(candidate.headword))).size === 3, `${entry.targetHeadword}: duplicate candidate headword`);

  for (const candidate of entry.candidates) {
    const item = itemBySenseId.get(candidate.senseId);
    assert(item && studyReadySenseIds.has(candidate.senseId), `${entry.targetHeadword}: candidate ${candidate.senseId} is not a formal study-ready sense`);
    assert(item.word.normalizedHeadword === normalize(candidate.headword), `${entry.targetHeadword}: candidate headword drift`);
    assert(item.sense.definitionZh === clean(candidate.definitionZh), `${entry.targetHeadword}: candidate definition drift`);
    assert(clean(candidate.rationale), `${entry.targetHeadword}: candidate ${candidate.headword} has no editorial rationale`);
    assert(item.word.id !== target.word.id, `${entry.targetHeadword}: self-confusable candidate`);
    assert(itemsAreCompatible(target, item), `${entry.targetHeadword}: candidate ${candidate.headword} is not option-compatible`);
    assert(
      definitionQuizPartOfSpeechFamily(item.sense.partOfSpeech)
        === definitionQuizPartOfSpeechFamily(target.sense.partOfSpeech),
      `${entry.targetHeadword}: candidate ${candidate.headword} has a different part of speech`,
    );
  }
  for (let left = 0; left < entry.candidates.length; left += 1) {
    for (let right = left + 1; right < entry.candidates.length; right += 1) {
      const first = itemBySenseId.get(entry.candidates[left].senseId);
      const second = itemBySenseId.get(entry.candidates[right].senseId);
      assert(
        itemsAreCompatible(first, second),
        `${entry.targetHeadword}: candidates ${entry.candidates[left].headword}/${entry.candidates[right].headword} conflict`,
      );
    }
  }

  const wordEntries = manifest.entries[entry.targetHeadword] ?? [];
  let review = wordEntries.find((candidate) => candidate.senseId === entry.targetSenseId)
    ?? wordEntries.find((candidate) => clean(candidate.definitionZh) === target.sense.definitionZh)
    ?? wordEntries.find((candidate) => clean(candidate.sourceDefinitionZh) === target.sense.definitionZh);
  if (!review) {
    review = {
      senseId: entry.targetSenseId,
      state: legacyEditorApprovedSenseIds.has(entry.targetSenseId)
        ? "editor_approved"
        : target.sense.studyReviewState,
      note: graphReviewNote,
    };
    wordEntries.push(review);
  }
  assert(review.state !== "excluded", `${entry.targetHeadword}: excluded review cannot receive distractors`);
  review.senseId = entry.targetSenseId;
  const graphOnlyReview = graphReviewNotes.has(review.note)
    && !review.sourceDefinitionZh
    && !review.openSenseId
    && !review.definitionZh
    && !review.definitionEn
    && !review.partOfSpeech
    && !review.dropExampleIds
    && !review.dropExampleTexts;
  review.state = graphOnlyReview && !legacyEditorApprovedSenseIds.has(entry.targetSenseId)
    ? "unreviewed"
    : review.state ?? target.sense.studyReviewState;
  if (graphOnlyReview) review.note = graphReviewNote;
  review.confusables = entry.candidates.map((candidate) => normalize(candidate.headword));
  review.confusableSenseIds = entry.candidates.map((candidate) => candidate.senseId);
  review.confusableRationales = Object.fromEntries(entry.candidates.map((candidate) => [candidate.senseId, clean(candidate.rationale)]));
  manifest.entries[entry.targetHeadword] = wordEntries;
}

manifest.reviewedCatalogVersion = catalog.catalogVersion;
manifest.reviewedAt = new Date().toISOString();
manifest.method = "Complete legacy formal-pool semantic review plus exact-sense distractor review for every quiz-target sense.";
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await server.close();
console.log(JSON.stringify({
  output: manifestPath,
  targets: entries.length,
  exactDistractorLinks: entries.length * 3,
  formalSenseCoverage: `${studyReadyItems.length}/${studyReadyItems.length}`,
  quizTargetCoverage: `${entries.length}/${quizTargetItems.length}`,
  distractorOnlySenses: studyReadyItems.length - quizTargetItems.length,
  primarySenseCoverage: `${primarySenseIds.size}/${primaryItems.length}`,
}, null, 2));
