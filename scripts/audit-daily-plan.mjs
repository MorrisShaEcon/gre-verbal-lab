import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalog = JSON.parse(await fs.readFile(path.join(root, "public/data/catalog.personal.json"), "utf8"));
const date = process.argv.find((argument) => argument.startsWith("--date="))?.split("=")[1] ?? new Date().toISOString().slice(0, 10);
const count = Number(process.argv.find((argument) => argument.startsWith("--count="))?.split("=")[1] ?? 20);
const server = await createServer({ root, logLevel: "silent", appType: "custom", server: { middlewareMode: true } });
const { buildDailyQueue, ensureLearningStates, studyExamplesFor } = await server.ssrLoadModule("/src/scheduler.ts");
const { createEmptyData } = await server.ssrLoadModule("/src/types.ts");
const data = createEmptyData(catalog.words, catalog.catalogVersion);
data.settings.dailyNewWords = count;
data.learning = ensureLearningStates(data.words, {});
const selected = buildDailyQueue(data, new Date(`${date}T09:00:00`));
console.log(JSON.stringify(selected.map(({ word, sense }) => {
  const examples = studyExamplesFor(word, sense);
  return {
    headword: word.headword,
    tier: word.frequencyProfile.tier,
    ipa: word.pronunciations[0]?.ipa ?? null,
    synonyms: sense.relations.synonyms.length,
    antonyms: sense.relations.antonyms.length,
    humanAudio: word.audioSources?.length > 0,
    contextKind: examples[0]?.kind ?? null,
    context: examples[0]?.text ?? null,
    contextSource: examples[0]?.sourceLabel ?? null,
  };
}), null, 2));
await server.close();
