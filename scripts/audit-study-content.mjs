import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const input = path.join(root, "public/data/catalog.personal.json");
const output = path.join(root, "imports/private/study-content-audit.json");
const catalog = JSON.parse(await fs.readFile(input, "utf8"));
const server = await createServer({ root, logLevel: "silent", appType: "custom", server: { middlewareMode: true } });
const {
  hasTrustedPronunciation,
  hasTrustedSenseAlignment,
  isQuizTargetSense,
  isStudyReadySense,
  sensePartOfSpeechMatchesKey,
} = await server.ssrLoadModule("/src/scheduler.ts");
const wordsReady = catalog.words.filter((word) => isQuizTargetSense(word, word.senses[0]));
const allSenses = catalog.words.flatMap((word) => word.senses.map((sense) => ({ word, sense })));
const readySenses = allSenses.filter(({ word, sense }) => isStudyReadySense(word, sense));
const quizTargetSenses = readySenses.filter(({ word, sense }) => isQuizTargetSense(word, sense));
const formalKeys = readySenses.map(({ word, sense }) => `${word.id}|${sense.openSenseId}`);
if (new Set(formalKeys).size !== formalKeys.length) throw new Error("Formal study pool contains duplicate word+openSenseId keys");
if (!readySenses.every(({ word }) => hasTrustedPronunciation(word))) throw new Error("Formal study pool contains untrusted IPA");
if (!readySenses.every(({ sense }) => hasTrustedSenseAlignment(sense))) throw new Error("Formal study pool contains heuristic alignment");
if (!readySenses.every(({ sense }) => sensePartOfSpeechMatchesKey(sense))) throw new Error("Formal study pool contains a POS mismatch");
const report = {
  catalogVersion: catalog.catalogVersion,
  generatedAt: new Date().toISOString(),
  words: catalog.words.length,
  senses: allSenses.length,
  primarySenseStudyReady: wordsReady.length,
  primarySenseBacklog: catalog.words.length - wordsReady.length,
  allStudyReadySenses: readySenses.length,
  quizTargetSenses: quizTargetSenses.length,
  distractorOnlySenses: readySenses.length - quizTargetSenses.length,
  uniqueFormalSenseKeys: new Set(formalKeys).size,
  formalAlignmentEvidence: readySenses.reduce((counts, { sense }) => {
    const key = /^Chinese Open Wordnet 1\.4.*; exact:/.test(sense.alignmentSource) ? "cow_exact" : "editor_approved";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {}),
  humanAudio: catalog.words.filter((word) => word.audioSources?.length).length,
  focusReady: wordsReady.filter((word) => word.frequencyProfile.tier === "focus").length,
  longTailReady: wordsReady.filter((word) => word.frequencyProfile.tier === "long-tail").length,
  sourceExamples: allSenses.flatMap(({ sense }) => sense.examples ?? []).reduce((counts, example) => {
    counts[example.kind] = (counts[example.kind] ?? 0) + 1;
    return counts;
  }, {}),
  rule: "A scheduled target must pass the canonical formal gate and must not be marked distractor_only; support senses can appear only as validated alternatives.",
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await server.close();
