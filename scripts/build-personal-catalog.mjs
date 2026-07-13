import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readXlsxTables } from "../src/xlsx-lite.ts";
import { alignChineseSense, loadChineseOpenWordnet } from "./lib/sense-alignment.mjs";
import {
  partOfSpeechFromSenseKey,
  pronunciationQualityForSource,
  strictAutomaticAlignmentState,
} from "./lib/content-quality.mjs";
import { findBoundCuratedContextSense } from "./lib/curated-context-policy.mjs";
import { selectDictionaryExampleTexts } from "./lib/dictionary-example-selection.mjs";
import { extractOewnRelations } from "./lib/oewn-relations.mjs";
import { injectPrivateGreQuestionMatches } from "./lib/private-gre-question-injection.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const privateDir = path.join(root, "imports/private");
const cacheDir = path.join(root, "data/cache");
const outputPath = path.join(root, "public/data/catalog.personal.json");
const sourceConfigPath = path.join(privateDir, "vocabulary-source-paths.json");
let sourceConfig;
try {
  sourceConfig = JSON.parse(await fs.readFile(sourceConfigPath, "utf8"));
} catch {
  throw new Error(`Missing local vocabulary source configuration: ${sourceConfigPath}`);
}
if (!sourceConfig?.coreWorkbook || !sourceConfig?.supplementWorkbook) {
  throw new Error("Local vocabulary source configuration needs coreWorkbook and supplementWorkbook paths.");
}
const resolveSourcePath = (value) => path.isAbsolute(value) ? value : path.resolve(root, value);
const corePath = resolveSourcePath(sourceConfig.coreWorkbook);
const supplementPath = resolveSourcePath(sourceConfig.supplementWorkbook);
const cmuPath = path.join(cacheDir, "cmudict.dict");
const wordnetPath = path.join(cacheDir, "english-wordnet-2025-json.zip");
const chineseWordnetPath = path.join(cacheDir, "omw-cmn-1.4.tar.xz");
const stage = process.argv.find((argument) => argument.startsWith("--stage="))?.split("=")[1] ?? "full";
const curatedContexts = JSON.parse(await fs.readFile(path.join(root, "data/curated-contexts.json"), "utf8"));
const alignmentOverrides = JSON.parse(await fs.readFile(path.join(root, "data/sense-alignment-overrides.json"), "utf8"));
const pronunciationOverrides = JSON.parse(await fs.readFile(path.join(root, "data/pronunciation-overrides.json"), "utf8"));
const publicStudyReviewTemplate = JSON.parse(await fs.readFile(path.join(root, "data/study-sense-reviews.json"), "utf8"));
let studySenseReviews = publicStudyReviewTemplate;
try {
  studySenseReviews = JSON.parse(await fs.readFile(path.join(privateDir, "study-sense-reviews.personal.json"), "utf8"));
} catch {}
const approvedStudySenseIds = new Set(studySenseReviews.approvedSenseIds ?? []);
let commonsAudio = { words: {} };
try { commonsAudio = JSON.parse(await fs.readFile(path.join(cacheDir, "commons-audio-index.json"), "utf8")); } catch {}

const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const clean = (value) => String(value ?? "").trim();
const validHeadword = (value) => /^[a-z][a-z' -]*$/i.test(clean(value)) && !/^list\d+$/i.test(clean(value));
const stableHash = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};
const stableId = (prefix, value) => `${prefix}-${stableHash(value).toString(36)}`;

async function readWorkbook(filePath) {
  const bytes = await fs.readFile(filePath);
  return readXlsxTables(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function parseCore(rows) {
  const headers = rows[0].map((value) => clean(value).toLowerCase());
  const word = headers.findIndex((value) => ["单词", "word", "headword"].includes(value));
  const pos = headers.findIndex((value) => ["词性", "pos", "part of speech"].includes(value));
  const definition = headers.findIndex((value) => ["释义", "definition", "meaning"].includes(value));
  const lapses = headers.findIndex((value) => ["遗忘次数", "lapses", "forget count"].includes(value));
  return rows.slice(1).filter((row) => validHeadword(row[word]) && clean(row[definition])).map((row) => ({
    headword: clean(row[word]),
    normalized: normalize(row[word]),
    partOfSpeech: pos >= 0 ? clean(row[pos]) : "",
    definition: clean(row[definition]),
    lapses: lapses >= 0 ? Number(row[lapses] ?? 0) || 0 : 0,
  }));
}

function parseSupplement(rows) {
  return rows.filter((row) => validHeadword(row[0]) && clean(row[1])).map((row) => ({
    headword: clean(row[0]),
    normalized: normalize(row[0]),
    definition: clean(row[1]),
  }));
}

function parseSenseLine(line) {
  const cleaned = line.trim().replace(/[；;]+$/, "");
  const match = cleaned.match(/^([a-z]{1,5}\.)\s*(.+)$/i);
  return match ? { partOfSpeech: match[1], definition: match[2].trim() } : { partOfSpeech: "", definition: cleaned };
}

function posCode(value) {
  const pos = value.toLowerCase();
  if (pos.startsWith("n")) return "n";
  if (pos.startsWith("v")) return "v";
  if (pos.startsWith("adj") || pos === "a." || pos === "a") return "a";
  if (pos.startsWith("adv") || pos === "r." || pos === "r") return "r";
  return "";
}

function zipJson(zipPath, entryName) {
  return JSON.parse(execFileSync("unzip", ["-p", zipPath, entryName], { encoding: "utf8", maxBuffer: 120 * 1024 * 1024 }));
}

function zipEntries(zipPath) {
  return execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
}

const vowelIpa = {
  AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔ", AW: "aʊ", AY: "aɪ", EH: "ɛ", ER: "ɝ", EY: "eɪ",
  IH: "ɪ", IY: "i", OW: "oʊ", OY: "ɔɪ", UH: "ʊ", UW: "u",
};
const consonantIpa = {
  B: "b", CH: "tʃ", D: "d", DH: "ð", F: "f", G: "ɡ", HH: "h", JH: "dʒ", K: "k", L: "l",
  M: "m", N: "n", NG: "ŋ", P: "p", R: "r", S: "s", SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w",
  Y: "j", Z: "z", ZH: "ʒ",
};

function arpabetToIpa(phonemes) {
  return phonemes.map((token) => {
    const match = token.match(/^([A-Z]+)([012])?$/);
    if (!match) return "";
    const [, phone, stress] = match;
    if (vowelIpa[phone]) {
      const sound = phone === "AH" && stress === "0" ? "ə" : phone === "ER" && stress === "0" ? "ɚ" : vowelIpa[phone];
      return `${stress === "1" ? "ˈ" : stress === "2" ? "ˌ" : ""}${sound}`;
    }
    return consonantIpa[phone] ?? "";
  }).join("");
}

async function loadCmuDictionary(targets) {
  const result = new Map();
  const text = await fs.readFile(cmuPath, "utf8");
  for (const line of text.split("\n")) {
    if (!line || line.startsWith(";;;")) continue;
    const [rawWord, ...phonemes] = line.trim().split(/\s+/);
    const word = normalize(rawWord.replace(/\(\d+\)$/, "").replaceAll("_", " "));
    if (!targets.has(word) || !phonemes.length) continue;
    const current = result.get(word) ?? [];
    const ipa = arpabetToIpa(phonemes);
    if (ipa && !current.some((item) => item.ipa === ipa)) current.push({
      ipa,
      dialect: "US",
      source: "CMUdict",
      quality: "approximate_transcription",
      reviewState: "auto_transcribed",
      sourceUrl: "https://github.com/cmusphinx/cmudict",
      license: "CMUdict permissive notice",
      phonemes,
    });
    result.set(word, current);
  }
  return result;
}

function exampleText(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.text === "string") return value.text;
  return "";
}

function normalizedAudioSources(sources = []) {
  const fallbackLicenseUrl = (license) => {
    if (/CC0/i.test(license)) return "https://creativecommons.org/publicdomain/zero/1.0/";
    if (/Public domain/i.test(license)) return "https://creativecommons.org/publicdomain/mark/1.0/";
    const version = license.match(/(\d\.\d)/)?.[1] ?? "4.0";
    if (/CC BY-SA/i.test(license)) return `https://creativecommons.org/licenses/by-sa/${version}/`;
    if (/CC BY/i.test(license)) return `https://creativecommons.org/licenses/by/${version}/`;
    return "";
  };
  return sources.map((source) => ({
    ...source,
    licenseUrl: source.licenseUrl || fallbackLicenseUrl(source.license),
  }));
}

async function loadWordNet(targets) {
  const entries = new Map();
  for (const name of zipEntries(wordnetPath).filter((name) => /^entries-[0a-z]\.json$/.test(name))) {
    const data = zipJson(wordnetPath, name);
    for (const [lemma, value] of Object.entries(data)) {
      const normalized = normalize(lemma);
      if (targets.has(normalized)) entries.set(normalized, value);
    }
  }
  const desiredSynsets = new Set();
  for (const entry of entries.values()) {
    for (const part of Object.values(entry)) {
      for (const sense of part.sense ?? []) desiredSynsets.add(sense.synset);
    }
  }
  const synsets = new Map();
  const synsetFiles = zipEntries(wordnetPath).filter((name) => name.endsWith(".json") && !name.startsWith("entries-") && name !== "frames.json");
  for (const name of synsetFiles) {
    const data = zipJson(wordnetPath, name);
    for (const [id, synset] of Object.entries(data)) if (desiredSynsets.has(id)) synsets.set(id, synset);
  }
  return { entries, synsets };
}

function alignmentOverrideFor(word, sense) {
  return (alignmentOverrides[word.normalized] ?? []).find((candidate) => (
    clean(candidate.definitionZh) === clean(sense.definition)
  ));
}

function studyReviewFor(word, sense, senseId) {
  return (studySenseReviews.entries?.[word.normalized] ?? []).find((candidate) => (
    candidate.senseId === senseId
    || clean(candidate.sourceDefinitionZh) === clean(sense.definition)
  ));
}

function enrichSense(word, sense, indexWithinPos, wordnetEntry, synsets, chineseByIli) {
  const code = posCode(sense.partOfSpeech);
  const parts = code ? [wordnetEntry?.[code]].filter(Boolean) : Object.values(wordnetEntry ?? {});
  const candidates = parts.flatMap((part) => part.sense ?? []);
  const senseId = stableId("sense", `${word.normalized}|${sense.partOfSpeech.toLowerCase()}|${sense.definition.replace(/\s+/g, "")}`);
  const override = alignmentOverrideFor(word, sense);
  const studyReview = studyReviewFor(word, sense, senseId);
  const studyReviewState = studyReview?.state ?? (approvedStudySenseIds.has(senseId) ? "editor_approved" : "unreviewed");
  const automatic = alignChineseSense(sense.definition, candidates, synsets, chineseByIli);
  const overriddenReference = override
    ? candidates.find((candidate) => synsets.get(candidate.synset)?.ili === override.ili)
    : undefined;
  const reviewedReference = studyReview?.openSenseId
    ? Object.values(wordnetEntry ?? {}).flatMap((part) => part.sense ?? []).find((candidate) => candidate.id === studyReview.openSenseId)
    : undefined;
  const fallbackReference = candidates[Math.min(indexWithinPos, Math.max(0, candidates.length - 1))];
  const reference = overriddenReference ?? reviewedReference ?? automatic.reference ?? fallbackReference;
  if (studyReviewState === "editor_approved" && !reference) {
    throw new Error(`Approved study review has no OEWN reference: ${word.normalized} / ${sense.definition}`);
  }
  const synset = reference ? synsets.get(reference.synset) : undefined;
  const dictionaryExamples = selectDictionaryExampleTexts((synset?.example ?? []).map(exampleText), word.normalized, 2).map((text, exampleIndex) => ({
    id: stableId("ctx", `${word.normalized}|${reference?.synset}|${exampleIndex}`),
    text,
    kind: "dictionary",
    sourceLabel: "Open English WordNet 2025",
    provenance: "CC BY 4.0",
    reviewState: "source_verified",
    rightsState: "open_reuse",
    allowedIn: ["public", "private"],
    sourceUrl: "https://en-word.net/",
  }));
  const overrideExamples = (override?.examples ?? []).map((example, exampleIndex) => ({
    id: stableId("ctx", `${word.normalized}|override|${override.ili}|${exampleIndex}|${example.text}`),
    rightsState: "unknown",
    allowedIn: [],
    ...example,
  }));
  // Only an exact Chinese Open Wordnet lemma is safe enough to become a
  // formal automatic alignment. Substring/gloss overlap remains useful audit
  // evidence, but stays a candidate until an editor reviews the sense.
  const automaticState = strictAutomaticAlignmentState(automatic);
  const editorApproved = studyReviewState === "editor_approved";
  const alignmentState = overriddenReference ? override.alignmentState : editorApproved ? "verified" : automaticState;
  const alignmentScore = overriddenReference ? override.alignmentScore : editorApproved ? 1 : automatic.score;
  const alignmentSource = overriddenReference
    ? override.alignmentSource
    : editorApproved
      ? `GRE Verbal Lab editorial review; OEWN sense ${reference?.id}; ${studyReview?.note ?? studySenseReviews.method ?? "full formal-pool semantic review"}`
    : automatic.reference
      ? `Chinese Open Wordnet 1.4 via CILI ${automatic.ili}; ${automatic.matchType}${automatic.matchedLemma ? `: ${automatic.matchedLemma}` : ""}`
      : "No cross-lingual sense evidence";
  const trustedAlignment = alignmentState === "verified";
  const lexical = extractOewnRelations({
    headword: word.normalized,
    reference,
    synset,
    trustedAlignment,
  });
  const confusables = [...new Set((studyReview?.confusables ?? []).map(normalize))]
    .filter((headword) => validHeadword(headword) && headword !== word.normalized);
  const confusableSenseIds = [...new Set((studyReview?.confusableSenseIds ?? []).map(clean))]
    .filter(Boolean);
  const confusableRationales = Object.fromEntries(confusableSenseIds
    .map((senseId) => [senseId, clean(studyReview?.confusableRationales?.[senseId])])
    .filter(([, rationale]) => rationale));
  const hasCheckedOewnRelationEvidence = lexical.evidence.synonyms.state !== "unverified"
    && lexical.evidence.antonyms.state !== "unverified";
  const partOfSpeech = studyReview?.partOfSpeech ?? (sense.partOfSpeech || partOfSpeechFromSenseKey(reference?.id));
  const rawExamples = trustedAlignment ? [...overrideExamples, ...dictionaryExamples] : [];
  const droppedExampleIds = new Set(studyReview?.dropExampleIds ?? []);
  const droppedExampleTexts = new Set(studyReview?.dropExampleTexts ?? []);
  const examples = rawExamples.filter((example) => !droppedExampleIds.has(example.id) && !droppedExampleTexts.has(example.text));
  return {
    id: senseId,
    partOfSpeech,
    definitionZh: studyReview?.definitionZh ?? sense.definition,
    definitionEn: studyReview?.definitionEn ?? (trustedAlignment ? synset?.definition?.[0] ?? "" : ""),
    sourceLabel: sense.sourceLabel,
    openSenseId: reference?.id ?? null,
    usageNote: "",
    contextNote: "",
    examples,
    relations: { ...lexical.relations, confusables },
    confusableSenseIds,
    confusableRationales,
    confusableSource: confusableSenseIds.length
      ? "GRE Verbal Lab editorial semantic-distractor review 2026-07-13"
      : "",
    relationState: hasCheckedOewnRelationEvidence ? "verified" : "unverified",
    relationSource: hasCheckedOewnRelationEvidence
      ? `Open English WordNet 2025 synset ${reference.synset} (CC BY 4.0)`
      : "Sense alignment is not verified; lexical relations withheld",
    relationEvidence: lexical.evidence,
    studyReviewState: overriddenReference ? "editor_approved" : studyReviewState,
    studyReviewNote: overriddenReference
      ? override.alignmentSource
      : studyReview?.note ?? (approvedStudySenseIds.has(senseId) ? studySenseReviews.method ?? "Full formal-pool semantic review" : ""),
    quizRole: studyReview?.quizRole === "distractor_only" ? "distractor_only" : "target_and_distractor",
    enrichmentState: overriddenReference || studyReviewState !== "unreviewed" ? "editor_reviewed" : synset ? "auto_candidate" : "missing",
    alignmentState,
    alignmentScore,
    alignmentSource,
  };
}

await fs.mkdir(privateDir, { recursive: true });
const [coreTables, supplementTables] = await Promise.all([readWorkbook(corePath), readWorkbook(supplementPath)]);
const core = parseCore(coreTables.find((table) => table.name.trim() === "词表")?.rows ?? coreTables[0].rows);
const supplement = parseSupplement(supplementTables[0].rows);
const supplementMap = new Map();
for (const row of supplement) supplementMap.set(row.normalized, [...(supplementMap.get(row.normalized) ?? []), row]);

if (stage === "base") {
  const headwords = core.map((row) => row.normalized);
  await fs.writeFile(path.join(privateDir, "core-headwords.json"), JSON.stringify(headwords, null, 2));
  console.log(JSON.stringify({ stage, headwords: headwords.length, output: path.join(privateDir, "core-headwords.json") }));
  process.exit(0);
}

for (const required of [cmuPath, wordnetPath, chineseWordnetPath]) {
  try { await fs.access(required); } catch { throw new Error(`Missing open-data cache: ${required}`); }
}

let corpus = { counts: {}, sources: [], method: "No local corpus evidence supplied." };
try { corpus = JSON.parse(await fs.readFile(path.join(privateDir, "corpus-evidence.json"), "utf8")); } catch {}

async function readOptionalPrivateJson(fileName) {
  const filePath = path.resolve(privateDir, fileName);
  const relative = path.relative(privateDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refusing to read private GRE source outside ${privateDir}`);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Unable to read ${filePath}: ${error.message}`);
  }
}

const [privateGreCorpus, privateGreSenseBindings] = await Promise.all([
  readOptionalPrivateJson("gre-question-corpus.json"),
  readOptionalPrivateJson("gre-question-sense-bindings.json"),
]);

const targets = new Set(core.map((row) => row.normalized));
const [cmu, wordnet] = await Promise.all([loadCmuDictionary(targets), loadWordNet(targets)]);
const chineseByIli = loadChineseOpenWordnet(chineseWordnetPath);
const words = [];
for (const coreRow of core) {
  const extras = supplementMap.get(coreRow.normalized) ?? [];
  const rawSenses = [{ partOfSpeech: coreRow.partOfSpeech, definition: coreRow.definition, sourceLabel: path.basename(corePath) }];
  const seen = new Set([coreRow.definition.replace(/[\s，,。；;（）()]/g, "").toLowerCase()]);
  for (const extra of extras) {
    for (const line of extra.definition.split(/\n|；/).filter(Boolean)) {
      const parsed = parseSenseLine(line);
      const key = parsed.definition.replace(/[\s，,。；;（）()]/g, "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rawSenses.push({ ...parsed, sourceLabel: path.basename(supplementPath) });
    }
  }
  const wordnetEntry = wordnet.entries.get(coreRow.normalized);
  const posIndexes = new Map();
  const senses = rawSenses.map((sense) => {
    const code = posCode(sense.partOfSpeech);
    const index = posIndexes.get(code) ?? 0;
    posIndexes.set(code, index + 1);
    return enrichSense(coreRow, sense, index, wordnetEntry, wordnet.synsets, chineseByIli);
  });
  const curated = curatedContexts[coreRow.normalized];
  const curatedTargetSense = findBoundCuratedContextSense(senses, curated);
  if (curatedTargetSense) {
    curatedTargetSense.examples.unshift({
      id: stableId("ctx", `${coreRow.normalized}|original-gre-style|${curated.openSenseId}`),
      text: curated.sentence,
      kind: "original_gre_style",
      sourceLabel: "GRE Verbal Lab editorial",
      provenance: "Original, not an ETS question",
      reviewState: "editor_reviewed",
      rightsState: "project_owned",
      allowedIn: ["public", "private"],
      sourceLocator: curated.openSenseId,
    });
    curatedTargetSense.enrichmentState = "editor_reviewed";
  }
  const primaryPart = wordnetEntry?.[posCode(coreRow.partOfSpeech)];
  const orderedParts = [primaryPart, ...Object.values(wordnetEntry ?? {}).filter((part) => part !== primaryPart)].filter(Boolean);
  const openPronunciations = [...new Set(orderedParts.flatMap((part) => part.pronunciation ?? []).map((item) => `${item.variety ?? "US"}|${item.value}`))]
    .map((value) => {
      const [dialect, ipa] = value.split("|");
      return {
        ipa,
        dialect,
        source: "Open English WordNet 2025",
        quality: pronunciationQualityForSource("Open English WordNet 2025"),
        reviewState: "source_verified",
        sourceUrl: "https://en-word.net/",
        license: "CC BY 4.0",
      };
    });
  let pronunciations = [...openPronunciations, ...(cmu.get(coreRow.normalized) ?? [])]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.ipa === item.ipa && candidate.dialect === item.dialect) === index)
    .slice(0, 3);
  if (curated?.ipa) pronunciations = [{
    ipa: curated.ipa,
    dialect: "US",
    source: "GRE Verbal Lab editorial review",
    quality: pronunciationQualityForSource("GRE Verbal Lab editorial review"),
    reviewState: "editor_reviewed",
  }, ...pronunciations.filter((item) => item.ipa !== curated.ipa)].slice(0, 3);
  const reviewedPronunciations = pronunciationOverrides[coreRow.normalized] ?? [];
  if (reviewedPronunciations.length) {
    pronunciations = [
      ...reviewedPronunciations,
      ...pronunciations.filter((item) => !reviewedPronunciations.some((override) => (
        override.ipa === item.ipa && override.dialect === item.dialect
      ))),
    ].slice(0, 3);
  }
  const evidence = corpus.counts?.[coreRow.normalized] ?? { total: 0, weightedTotal: 0, official: 0, privatePractice: 0, bySource: {} };
  words.push({
    id: stableId("word", coreRow.normalized),
    headword: coreRow.headword,
    normalizedHeadword: coreRow.normalized,
    pronunciations,
    audioSources: normalizedAudioSources(commonsAudio.words?.[coreRow.normalized]?.audio),
    senses,
    sourceFiles: [path.basename(corePath), ...(extras.length ? [path.basename(supplementPath)] : [])],
    initialLapses: coreRow.lapses,
    sourceConsensus: extras.length > 0,
    frequencyProfile: { tier: "unranked", rank: 0, priorityScore: 0, localMaterialCount: evidence.total, officialMaterialCount: evidence.official, evidenceBySource: evidence.bySource },
    order: stableHash(coreRow.normalized),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

const evidenceFor = (word) => corpus.counts?.[word.normalizedHeadword] ?? { weightedTotal: word.frequencyProfile.localMaterialCount };
const maxLogCount = Math.max(1, ...words.map((word) => Math.log1p(evidenceFor(word).weightedTotal ?? word.frequencyProfile.localMaterialCount)));
for (const word of words) {
  const occurrence = Math.log1p(evidenceFor(word).weightedTotal ?? word.frequencyProfile.localMaterialCount) / maxLogCount;
  const score = occurrence * 50 + (word.sourceConsensus ? 25 : 0) + (word.frequencyProfile.officialMaterialCount > 0 ? 15 : 0) + Math.min(10, word.initialLapses * 2);
  word.frequencyProfile.priorityScore = Number(score.toFixed(2));
}
const ranked = [...words].sort((a, b) => b.frequencyProfile.priorityScore - a.frequencyProfile.priorityScore || a.order - b.order);
const focusLimit = Math.ceil(ranked.length * 0.7);
ranked.forEach((word, index) => {
  word.frequencyProfile.rank = index + 1;
  word.frequencyProfile.tier = index < focusLimit ? "focus" : "long-tail";
});

const privateGreInjection = injectPrivateGreQuestionMatches(words, privateGreCorpus, privateGreSenseBindings, {
  maxPerSense: 3,
  requireReviewedBindings: true,
});
const personalWords = privateGreInjection.words;

const catalog = {
  schemaVersion: 2,
  catalogVersion: "2026.07.13-personal.7",
  generatedAt: new Date().toISOString(),
  visibility: "private-local-build",
  samplingPolicy: { focusShare: 0.7, longTailShare: 0.3, description: "70% priority evidence pool + 30% long-tail exploration; deterministic daily shuffle." },
  provenance: [
    { id: "user-core", label: path.basename(corePath), visibility: "private", role: "core scope and Chinese definitions" },
    { id: "user-supplement", label: path.basename(supplementPath), visibility: "private", role: "supplemental senses" },
    { id: "cmudict", label: "CMU Pronouncing Dictionary", url: "https://github.com/cmusphinx/cmudict", license: "CMUdict permissive notice" },
    { id: "oewn-2025", label: "Open English WordNet 2025", url: "https://github.com/globalwordnet/english-wordnet", license: "CC BY 4.0" },
    { id: "omw-cmn-1.4", label: "Chinese Open Wordnet 1.4", url: "https://omwn.org/omw1.html", license: "WordNet license; Francis Bond & Shan Wang 2013, 2014" },
    { id: "wiktionary", label: "Wiktionary editorial sense overrides", url: "https://en.wiktionary.org/", license: "CC BY-SA 4.0" },
    { id: "lingua-libre", label: "Lingua Libre recordings via Wikimedia Commons", url: "https://commons.wikimedia.org/wiki/Category:Lingua_Libre_pronunciation-eng", license: "Per-file open license stored with each recording" },
  ],
  corpusMethod: corpus.method,
  corpusSources: corpus.sources,
  greQuestionCorpusStats: privateGreInjection.report,
  words: personalWords,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(catalog));
const senseCount = personalWords.reduce((sum, word) => sum + word.senses.length, 0);
const report = {
  stage,
  output: outputPath,
  words: personalWords.length,
  senses: senseCount,
  focus: personalWords.filter((word) => word.frequencyProfile.tier === "focus").length,
  longTail: personalWords.filter((word) => word.frequencyProfile.tier === "long-tail").length,
  pronunciationCoverage: personalWords.filter((word) => word.pronunciations.length).length,
  humanAudioCoverage: personalWords.filter((word) => word.audioSources.length).length,
  relationCoverage: personalWords.filter((word) => word.senses.some((sense) => (
    sense.relationState === "verified" && (sense.relations.synonyms.length || sense.relations.antonyms.length)
  ))).length,
  contextCoverage: personalWords.filter((word) => word.senses.some((sense) => sense.examples.length)).length,
  verifiedAlignmentCoverage: personalWords.filter((word) => word.senses.some((sense) => sense.alignmentState === "verified")).length,
  corpusMatched: personalWords.filter((word) => word.frequencyProfile.localMaterialCount > 0).length,
  greQuestionInjection: privateGreInjection.report,
};
await fs.writeFile(path.join(privateDir, "catalog-coverage.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
