import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { extractOewnRelations } from "./lib/oewn-relations.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogPath = path.join(root, "public/data/catalog.personal.json");
const wordnetPath = path.join(root, "data/cache/english-wordnet-2025-json.zip");
const outputPath = path.join(root, "imports/private/lexical-relation-audit.json");
const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function zipEntries() {
  return execFileSync("unzip", ["-Z1", wordnetPath], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
}

function zipJson(entryName) {
  return JSON.parse(execFileSync("unzip", ["-p", wordnetPath, entryName], {
    encoding: "utf8",
    maxBuffer: 120 * 1024 * 1024,
  }));
}

const catalogSenses = catalog.words.flatMap((word) => word.senses.map((sense) => ({ word, sense })));
const targetSenseIds = new Set(catalogSenses.map(({ sense }) => sense.openSenseId).filter(Boolean));
const targetReferences = new Map();
const allAntonymEdges = [];
const allSenseIds = new Set();

for (const name of zipEntries().filter((entry) => /^entries-[0a-z]\.json$/.test(entry))) {
  const entries = zipJson(name);
  for (const entry of Object.values(entries)) {
    for (const part of Object.values(entry)) {
      for (const reference of part.sense ?? []) {
        allSenseIds.add(reference.id);
        if (targetSenseIds.has(reference.id)) targetReferences.set(reference.id, reference);
        for (const target of reference.antonym ?? []) allAntonymEdges.push([reference.id, target]);
      }
    }
  }
}

const desiredSynsetIds = new Set([...targetReferences.values()].map((reference) => reference.synset));
const synsets = new Map();
for (const name of zipEntries().filter((entry) => (
  entry.endsWith(".json") && !entry.startsWith("entries-") && entry !== "frames.json"
))) {
  for (const [id, synset] of Object.entries(zipJson(name))) {
    if (desiredSynsetIds.has(id)) synsets.set(id, synset);
  }
}

const edgeKeys = new Set(allAntonymEdges.map(([source, target]) => `${source}\u0000${target}`));
const asymmetricAntonymEdges = allAntonymEdges.filter(([source, target]) => !edgeKeys.has(`${target}\u0000${source}`));
const brokenAntonymTargets = allAntonymEdges.filter(([, target]) => !allSenseIds.has(target));
const relationDiffs = [];

for (const { word, sense } of catalogSenses) {
  const reference = targetReferences.get(sense.openSenseId);
  const synset = reference ? synsets.get(reference.synset) : undefined;
  const expected = extractOewnRelations({
    headword: word.normalizedHeadword,
    reference,
    synset,
    trustedAlignment: sense.alignmentState === "verified",
  });
  const actualComparable = {
    relations: {
      synonyms: sense.relations.synonyms,
      antonyms: sense.relations.antonyms,
      confusables: [],
    },
    evidence: sense.relationEvidence,
  };
  if (JSON.stringify(actualComparable) !== JSON.stringify(expected)) {
    relationDiffs.push({ headword: word.headword, senseId: sense.id, openSenseId: sense.openSenseId });
  }
}

const server = await createServer({ root, logLevel: "silent", appType: "custom", server: { middlewareMode: true } });
const { isStudyReadySense } = await server.ssrLoadModule("/src/scheduler.ts");
const studyReady = catalogSenses.filter(({ word, sense }) => isStudyReadySense(word, sense));

function stateCounts(rows, kind) {
  return rows.reduce((counts, { sense }) => {
    const state = sense.relationEvidence[kind].state;
    counts[state] = (counts[state] ?? 0) + 1;
    return counts;
  }, { verified_present: 0, source_checked_absent: 0, unverified: 0 });
}

const acclaimNoun = catalogSenses.find(({ word, sense }) => word.normalizedHeadword === "acclaim" && sense.partOfSpeech.toLowerCase().startsWith("n"));
const report = {
  catalogVersion: catalog.catalogVersion,
  generatedAt: new Date().toISOString(),
  catalogSenses: catalogSenses.length,
  verifiedAlignedSenses: catalogSenses.filter(({ sense }) => sense.alignmentState === "verified").length,
  studyReadySenses: studyReady.length,
  studyReadyRelations: {
    synonyms: stateCounts(studyReady, "synonyms"),
    antonyms: stateCounts(studyReady, "antonyms"),
  },
  oewnGraph: {
    lexicalSenses: allSenseIds.size,
    antonymEdges: allAntonymEdges.length,
    asymmetricAntonymEdges: asymmetricAntonymEdges.length,
    brokenAntonymTargets: brokenAntonymTargets.length,
  },
  catalogRelationDiffs: relationDiffs.length,
  acclaimNoun: acclaimNoun ? {
    openSenseId: acclaimNoun.sense.openSenseId,
    synonyms: acclaimNoun.sense.relations.synonyms,
    antonyms: acclaimNoun.sense.relations.antonyms,
    relationEvidence: acclaimNoun.sense.relationEvidence,
  } : null,
  qualityBoundary: "Only aligned OEWN synset co-members and lexical-sense antonym edges are extracted. Source-checked absence means OEWN 2025 does not record a direct relation for that aligned sense; it is not a claim that no such relation exists anywhere.",
};

assert(asymmetricAntonymEdges.length === 0, `OEWN contains ${asymmetricAntonymEdges.length} asymmetric antonym edges`);
assert(brokenAntonymTargets.length === 0, `OEWN contains ${brokenAntonymTargets.length} broken antonym targets`);
assert(relationDiffs.length === 0, `Catalog has ${relationDiffs.length} lexical relation extraction differences`);
assert(studyReady.every(({ sense }) => (
  sense.relationEvidence.synonyms.state !== "unverified"
  && sense.relationEvidence.antonyms.state !== "unverified"
)), "Study-ready senses include unverified per-kind relation evidence");

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await server.close();
