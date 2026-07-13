import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({ root, logLevel: "silent", appType: "custom", server: { middlewareMode: true } });
const {
  areDeclaredDefinitionQuizSynonyms,
  createDefinitionQuizQuestion,
  definitionQuizConceptKeys,
  definitionQuizPartOfSpeechFamily,
  definitionsAreTooClose,
  hasExplicitDefinitionQuizRelation,
} = await server.ssrLoadModule("/src/quiz.ts");
const { ensureLearningStates, isQuizTargetSense, isStudyReadySense } = await server.ssrLoadModule("/src/scheduler.ts");
const { createEmptyData } = await server.ssrLoadModule("/src/types.ts");
const catalog = JSON.parse(await fs.readFile(path.join(root, "public/data/catalog.personal.json"), "utf8"));
const date = process.argv.find((argument) => argument.startsWith("--date="))?.split("=")[1] ?? "2026-07-13";
const data = createEmptyData(catalog.words, catalog.catalogVersion);
data.learning = ensureLearningStates(data.words, {});
const studyReady = data.words.flatMap((word) => word.senses
  .filter((sense) => isStudyReadySense(word, sense))
  .map((sense) => ({ word, sense })));
const quizTargets = studyReady.filter(({ word, sense }) => isQuizTargetSense(word, sense));
if (!studyReady.length) {
  throw new Error("Quiz audit found no study-ready senses; rebuild or repair the catalog before treating this audit as passed.");
}
const primaryStudyReady = data.words
  .filter((word) => word.senses[0] && isQuizTargetSense(word, word.senses[0]))
  .map((word) => ({ word, sense: word.senses[0] }));
const itemBySenseId = new Map(data.words.flatMap((word) => word.senses.map((sense) => [sense.id, { word, sense }])));
const questions = quizTargets.map((item, index) => createDefinitionQuizQuestion({
  word: item.word,
  sense: item.sense,
  catalogWords: data.words,
  attemptSeed: `audit-${date}-${index}`,
}));

const normalizeOptionText = (value) => String(value ?? "")
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[\s·•.,，。;；:：!?！？'"“”‘’()（）\[\]【】/\\\-]+/g, "")
  .trim();

const conceptOverlap = (left, right) => {
  const leftKeys = new Set(definitionQuizConceptKeys(left));
  return definitionQuizConceptKeys(right).some((key) => leftKeys.has(key));
};

const definitionsConflict = (left, right) => definitionsAreTooClose(left.definitionZh, right.definitionZh)
  || Boolean(
    left.definitionEn.trim()
    && right.definitionEn.trim()
    && definitionsAreTooClose(left.definitionEn, right.definitionEn),
  );

const itemsAreCompatible = (left, right) => (
  left.word.id !== right.word.id
  && !conceptOverlap(left.sense, right.sense)
  && !areDeclaredDefinitionQuizSynonyms(left.word, left.sense, right.word, right.sense)
  && !definitionsConflict(left.sense, right.sense)
);

for (const target of quizTargets) {
  const exactIds = target.sense.confusableSenseIds ?? [];
  if (exactIds.length !== 3 || target.sense.relations.confusables.length !== 3) {
    throw new Error(`${target.word.headword}: formal sense needs exactly three editorial confusables`);
  }
  for (const [index, senseId] of exactIds.entries()) {
    const candidate = itemBySenseId.get(senseId);
    if (!candidate || !isStudyReadySense(candidate.word, candidate.sense)) {
      throw new Error(`${target.word.headword}: editorial confusable ${senseId} is not study-ready`);
    }
    if (candidate.word.normalizedHeadword !== target.sense.relations.confusables[index]) {
      throw new Error(`${target.word.headword}: editorial confusable headword/sense binding drifted`);
    }
    if (!itemsAreCompatible(target, candidate)) {
      throw new Error(`${target.word.headword}: editorial confusable ${candidate.word.headword} is not option-compatible`);
    }
    if (
      definitionQuizPartOfSpeechFamily(candidate.sense.partOfSpeech)
      !== definitionQuizPartOfSpeechFamily(target.sense.partOfSpeech)
    ) {
      throw new Error(`${target.word.headword}: editorial confusable ${candidate.word.headword} is not the same part of speech`);
    }
  }
}

function hasThreeCompatibleSamePartOfSpeech(target) {
  const targetPartOfSpeech = definitionQuizPartOfSpeechFamily(target.sense.partOfSpeech);
  const candidates = studyReady.filter((candidate) => (
    definitionQuizPartOfSpeechFamily(candidate.sense.partOfSpeech) === targetPartOfSpeech
    && itemsAreCompatible(target, candidate)
  ));

  for (let first = 0; first < candidates.length; first += 1) {
    for (let second = first + 1; second < candidates.length; second += 1) {
      if (!itemsAreCompatible(candidates[first], candidates[second])) continue;
      for (let third = second + 1; third < candidates.length; third += 1) {
        if (
          itemsAreCompatible(candidates[first], candidates[third])
          && itemsAreCompatible(candidates[second], candidates[third])
        ) return true;
      }
    }
  }
  return false;
}

let totalDistractors = 0;
let samePartOfSpeechDistractors = 0;
let explicitRelationDistractors = 0;
let allSamePartOfSpeechQuestions = 0;
let questionsWithExplicitRelation = 0;
let samePartOfSpeechPoolSufficientQuestions = 0;
let quizTargetQuestionsUsingAllEditorialConfusables = 0;

for (const question of questions) {
  if (question.options.length !== 4) throw new Error(`${question.headword}: expected four options`);
  if (question.distractorSenseIds.length !== 3 || new Set(question.distractorSenseIds).size !== 3) {
    throw new Error(`${question.headword}: expected three unique distractor senses`);
  }
  if (new Set(question.options.map((option) => option.id)).size !== 4) throw new Error(`${question.headword}: duplicate option id`);
  if (new Set(question.options.map((option) => normalizeOptionText(option.text))).size !== 4) {
    throw new Error(`${question.headword}: duplicate option text`);
  }
  if (new Set(question.options.map((option) => option.senseId)).size !== 4) throw new Error(`${question.headword}: duplicate option sense`);
  if (question.options.filter((option) => option.id === question.correctOptionId).length !== 1) throw new Error(`${question.headword}: incorrect answer key`);

  const target = itemBySenseId.get(question.senseId);
  if (!target) throw new Error(`${question.headword}: target sense not found`);
  const distractors = question.distractorSenseIds.map((senseId) => {
    const item = itemBySenseId.get(senseId);
    if (!item) throw new Error(`${question.headword}: distractor sense ${senseId} not found`);
    if (!isStudyReadySense(item.word, item.sense)) {
      throw new Error(`${question.headword}: distractor ${item.word.headword}/${senseId} is not study-ready`);
    }
    if (!itemsAreCompatible(target, item)) {
      throw new Error(`${question.headword}: distractor ${item.word.headword}/${senseId} duplicates the target concept`);
    }
    return item;
  });
  const editorialIds = new Set(target.sense.confusableSenseIds ?? []);
  if (!question.distractorSenseIds.every((senseId) => editorialIds.has(senseId))) {
    throw new Error(`${question.headword}: formal question did not use all three reviewed semantic distractors`);
  }
  quizTargetQuestionsUsingAllEditorialConfusables += 1;

  const conceptKeys = new Set();
  for (const item of [target, ...distractors]) {
    for (const key of definitionQuizConceptKeys(item.sense)) {
      if (conceptKeys.has(key)) throw new Error(`${question.headword}: repeated concept ${key}`);
      conceptKeys.add(key);
    }
  }

  for (let left = 0; left < distractors.length; left += 1) {
    for (let right = left + 1; right < distractors.length; right += 1) {
      if (!itemsAreCompatible(distractors[left], distractors[right])) {
        throw new Error(`${question.headword}: distractors do not represent unique concepts`);
      }
    }
  }

  for (let left = 0; left < question.options.length; left += 1) {
    for (let right = left + 1; right < question.options.length; right += 1) {
      if (definitionsAreTooClose(question.options[left].text, question.options[right].text)) {
        throw new Error(`${question.headword}: defensibly equivalent options: ${question.options[left].text} / ${question.options[right].text}`);
      }
    }
  }

  totalDistractors += distractors.length;
  const samePartOfSpeech = distractors.filter((item) => (
    definitionQuizPartOfSpeechFamily(item.sense.partOfSpeech)
    === definitionQuizPartOfSpeechFamily(target.sense.partOfSpeech)
  )).length;
  const explicitRelations = distractors.filter((item) => (
    hasExplicitDefinitionQuizRelation(target.word, target.sense, item.word, item.sense)
  )).length;
  samePartOfSpeechDistractors += samePartOfSpeech;
  explicitRelationDistractors += explicitRelations;
  if (samePartOfSpeech === 3) allSamePartOfSpeechQuestions += 1;
  if (explicitRelations > 0) questionsWithExplicitRelation += 1;

  const samePartOfSpeechPoolSufficient = hasThreeCompatibleSamePartOfSpeech(target);
  if (samePartOfSpeechPoolSufficient) samePartOfSpeechPoolSufficientQuestions += 1;
  if (samePartOfSpeechPoolSufficient && samePartOfSpeech !== 3) {
    throw new Error(`${question.headword}: same-POS formal pool is sufficient, but a cross-POS distractor was selected`);
  }
}

const percentage = (count, total) => total ? Number(((count / total) * 100).toFixed(2)) : 0;

console.log(JSON.stringify({
  catalogVersion: catalog.catalogVersion,
  questions: questions.length,
  distractors: totalDistractors,
  allHaveFourUniqueOptions: true,
  allDistractorsStudyReady: true,
  allConceptsUnique: true,
  noDefensiblyEquivalentOptions: true,
  primaryStudyReadySenses: primaryStudyReady.length,
  formalStudyReadySenses: studyReady.length,
  distractorOnlySenses: studyReady.length - quizTargets.length,
  quizTargetSenses: quizTargets.length,
  quizTargetQuestionsUsingAllEditorialConfusables,
  coverage: {
    samePartOfSpeech: {
      distractors: samePartOfSpeechDistractors,
      ratePercent: percentage(samePartOfSpeechDistractors, totalDistractors),
      questionsWithAllThree: allSamePartOfSpeechQuestions,
      questionsWithSufficientPool: samePartOfSpeechPoolSufficientQuestions,
    },
    explicitConfusableOrAntonymRelation: {
      distractors: explicitRelationDistractors,
      ratePercent: percentage(explicitRelationDistractors, totalDistractors),
      questionsWithAtLeastOne: questionsWithExplicitRelation,
    },
  },
  sample: questions.slice(0, 5).map((question) => ({
    headword: question.headword,
    correct: question.options.find((option) => option.id === question.correctOptionId)?.text,
    choices: question.options.map((option) => option.text),
  })),
}, null, 2));
await server.close();
