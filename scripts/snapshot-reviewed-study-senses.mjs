import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalog = JSON.parse(await fs.readFile(path.join(root, "public/data/catalog.personal.json"), "utf8"));
const output = path.join(root, "imports/private/study-sense-reviews.personal.json");
const server = await createServer({ root, logLevel: "silent", appType: "custom", server: { middlewareMode: true } });
const { studyExamplesFor } = await server.ssrLoadModule("/src/scheduler.ts");

// This snapshots the exact 315-item pool that the three editorial review
// batches covered before the conservative v2.1 gate was introduced. It must
// only be run against that reviewed catalog version.
const approvedSenseIds = catalog.words.flatMap((word) => word.senses
  .filter((sense) => (
    sense.alignmentState === "verified"
    && word.pronunciations.some((pronunciation) => pronunciation.ipa?.trim())
    && [sense.relationEvidence?.synonyms?.state, sense.relationEvidence?.antonyms?.state].includes("verified_present")
    && studyExamplesFor(word, sense).length > 0
  ))
  .map((sense) => sense.id));

if (catalog.catalogVersion !== "2026.07.13-personal.5" || approvedSenseIds.length !== 315) {
  throw new Error(`Expected the reviewed personal.5 pool of 315 senses; found ${catalog.catalogVersion} / ${approvedSenseIds.length}`);
}

let existing = { entries: {} };
try { existing = JSON.parse(await fs.readFile(output, "utf8")); } catch {}
const manifest = {
  schemaVersion: 1,
  reviewedCatalogVersion: catalog.catalogVersion,
  reviewedAt: new Date().toISOString(),
  method: "Three independent semantic-review batches covering the complete legacy formal pool in catalog order (indices 0-314).",
  approvedSenseIds,
  entries: existing.entries ?? {},
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output, approvedSenseIds: approvedSenseIds.length, preservedEntryWords: Object.keys(manifest.entries).length }));
await server.close();
