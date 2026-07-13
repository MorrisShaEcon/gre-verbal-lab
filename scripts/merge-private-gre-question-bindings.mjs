import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const privateDir = path.join(root, "imports/private");
const outputPath = path.join(privateDir, "gre-question-sense-bindings.json");
const defaultInputs = [
  "gre-question-bindings-batch-1.json",
  "gre-question-bindings-batch-2.json",
  "gre-question-bindings-batch-3.json",
  "gre-question-bindings-delta.json",
  "gre-question-bindings-inflection-delta.json",
];
const requestedInputs = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const inputNames = requestedInputs.length ? requestedInputs : defaultInputs;

const states = new Set(["confirmed_sense", "word_form_only", "rejected"]);
const grouped = {};
const seen = new Map();
const loaded = [];

for (const name of inputNames) {
  const inputPath = path.resolve(privateDir, name);
  const relative = path.relative(privateDir, inputPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refusing to read binding outside ${privateDir}`);
  let payload;
  try {
    payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" && !requestedInputs.length) continue;
    throw error;
  }
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.entries)) throw new Error(`${name}: expected schemaVersion 1 and entries[]`);
  loaded.push(name);
  for (const item of payload.entries) {
    const senseId = String(item.senseId ?? "").trim();
    const questionId = String(item.questionId ?? "").trim();
    const reviewNote = String(item.reviewNote ?? "").trim();
    if (!senseId || !questionId || !states.has(item.senseMatchState) || !reviewNote) {
      throw new Error(`${name}: incomplete manual review entry for ${senseId || "missing-sense"}/${questionId || "missing-question"}`);
    }
    const key = `${senseId}|${questionId}`;
    const normalized = { questionId, senseMatchState: item.senseMatchState, reviewNote };
    const previous = seen.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) throw new Error(`${name}: conflicting duplicate ${key}`);
    if (previous) continue;
    seen.set(key, normalized);
    (grouped[senseId] ??= []).push(normalized);
  }
}

if (!loaded.length) throw new Error("No reviewed GRE question binding batches were found.");
for (const bindings of Object.values(grouped)) bindings.sort((left, right) => left.questionId.localeCompare(right.questionId));

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method: "Every selected exact or conservative regular-inflection candidate was read in its full local question context and classified against an exact reviewed vocabulary sense.",
  sourceBatches: loaded,
  entries: Object.fromEntries(Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right))),
};
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);

const all = Object.values(grouped).flat();
console.log(JSON.stringify({
  outputPath,
  inputBatches: loaded,
  senses: Object.keys(grouped).length,
  bindings: all.length,
  confirmedSense: all.filter((item) => item.senseMatchState === "confirmed_sense").length,
  wordFormOnly: all.filter((item) => item.senseMatchState === "word_form_only").length,
  rejected: all.filter((item) => item.senseMatchState === "rejected").length,
}));
