import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { alignChineseSense, loadChineseOpenWordnet } from "./lib/sense-alignment.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogPath = path.join(root, "public/data/catalog.personal.json");
const oewnPath = path.join(root, "data/cache/english-wordnet-2025-json.zip");
const omwPath = path.join(root, "data/cache/omw-cmn-1.4.tar.xz");

const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const posCode = (value) => {
  const pos = String(value ?? "").toLowerCase();
  if (pos.startsWith("n")) return "n";
  if (pos.startsWith("v")) return "v";
  if (pos.startsWith("adj") || pos === "a." || pos === "a") return "a";
  if (pos.startsWith("adv") || pos === "r." || pos === "r") return "r";
  return "";
};
const zipJson = (entryName) => JSON.parse(execFileSync(
  "unzip",
  ["-p", oewnPath, entryName],
  { encoding: "utf8", maxBuffer: 120 * 1024 * 1024 },
));

const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
const targets = new Set(catalog.words.map((word) => normalize(word.normalizedHeadword)));
const entries = new Map();
for (const letter of "0abcdefghijklmnopqrstuvwxyz") {
  const data = zipJson(`entries-${letter}.json`);
  for (const [lemma, entry] of Object.entries(data)) {
    const normalized = normalize(lemma);
    if (targets.has(normalized)) entries.set(normalized, entry);
  }
}

const desiredSynsets = new Set();
for (const entry of entries.values()) {
  for (const part of Object.values(entry)) for (const sense of part.sense ?? []) desiredSynsets.add(sense.synset);
}
const synsets = new Map();
const filenames = execFileSync("unzip", ["-Z1", oewnPath], { encoding: "utf8" }).trim().split("\n");
for (const filename of filenames.filter((name) => name.endsWith(".json") && !name.startsWith("entries-") && name !== "frames.json")) {
  const data = zipJson(filename);
  for (const [id, synset] of Object.entries(data)) if (desiredSynsets.has(id)) synsets.set(id, synset);
}

const chineseByIli = loadChineseOpenWordnet(omwPath);
const rows = [];
for (const word of catalog.words) {
  const entry = entries.get(normalize(word.normalizedHeadword));
  for (const [senseIndex, sense] of word.senses.entries()) {
    const code = posCode(sense.partOfSpeech);
    const parts = code ? [entry?.[code]].filter(Boolean) : Object.values(entry ?? {});
    const candidates = parts.flatMap((part) => part.sense ?? []);
    const result = alignChineseSense(sense.definitionZh, candidates, synsets, chineseByIli);
    rows.push({
      word: word.normalizedHeadword,
      senseIndex,
      pos: sense.partOfSpeech,
      definitionZh: sense.definitionZh,
      previousSenseKey: sense.openSenseId,
      previousDefinitionEn: sense.definitionEn,
      catalogAlignmentState: sense.alignmentState ?? "unverified",
      catalogAlignmentScore: sense.alignmentScore ?? 0,
      catalogAlignmentSource: sense.alignmentSource ?? "",
      ...result,
    });
  }
}

const byState = Object.fromEntries(["verified", "candidate", "missing"].map((state) => [state, rows.filter((row) => row.state === state).length]));
const changedVerified = rows.filter((row) => row.state === "verified" && row.reference?.id !== row.previousSenseKey);
const count = rows.filter((row) => row.word === "count");
const watchWords = new Set(["august", "bank", "cleave", "count", "cow", "discriminate", "flag", "grant", "intimate", "qualify", "revolt", "sanction", "sanguine", "table", "temper"]);
const watchlist = rows.filter((row) => watchWords.has(row.word));
const risky = rows.filter((row) => row.state === "verified" && row.matchType !== "exact").slice(0, 40);
const sample = rows.filter((row) => row.state === "verified").sort((a, b) => b.margin - a.margin).slice(0, 30);
const verifiedByMatchType = Object.fromEntries([...new Set(rows.map((row) => row.matchType))].sort().map((matchType) => [
  matchType,
  rows.filter((row) => row.state === "verified" && row.matchType === matchType).length,
]));
const primaryRows = rows.filter((row) => row.senseIndex === 0);
const primaryVerified = primaryRows.filter((row) => row.state === "verified").length;
const verifiedWords = new Set(rows.filter((row) => row.state === "verified").map((row) => row.word)).size;
const catalogVerifiedRows = rows.filter((row) => row.catalogAlignmentState === "verified");
const catalogOverrideVerified = catalogVerifiedRows.filter((row) => row.state !== "verified").length;
const catalogVerifiedWords = new Set(catalogVerifiedRows.map((row) => row.word)).size;

const compact = (row) => ({
  word: row.word,
  pos: row.pos,
  definitionZh: row.definitionZh,
  state: row.state,
  score: row.score,
  margin: row.margin,
  matchedLemma: row.matchedLemma,
  matchType: row.matchType,
  senseKey: row.reference?.id ?? null,
  definitionEn: row.synset?.definition?.[0] ?? "",
  previousSenseKey: row.previousSenseKey,
});

console.log(JSON.stringify({
  source: {
    chineseOpenWordnet: "omw-cmn:1.4 (WordNet license)",
    openEnglishWordnet: "OEWN 2025 (CC BY 4.0)",
    bridge: "Collaborative Interlingual Index (ILI)",
  },
  totals: {
    senses: rows.length,
    ...byState,
    verifiedCoverage: Number((byState.verified / rows.length).toFixed(4)),
    verifiedWords,
    primarySenses: primaryRows.length,
    primaryVerified,
    primaryVerifiedCoverage: Number((primaryVerified / primaryRows.length).toFixed(4)),
    catalogVerified: catalogVerifiedRows.length,
    catalogVerifiedWords,
    catalogOverrideVerified,
    changedVerified: changedVerified.length,
    verifiedByMatchType,
  },
  count: count.map(compact),
  polysemyWatchlist: watchlist.map(compact),
  changedVerifiedSample: changedVerified.slice(0, 40).map(compact),
  highMarginSample: sample.map(compact),
  reviewSample: risky.map(compact),
}, null, 2));
