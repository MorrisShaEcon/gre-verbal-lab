import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowedCommonsLicense, englishAudioEvidence } from "./lib/commons-audio-policy.mjs";
import { isTrustedPronunciation, sensePartOfSpeechMatches } from "./lib/content-quality.mjs";
import {
  assertNoPrivateGreQuestionLeak,
  stripPrivateGreQuestionFields,
} from "./lib/private-gre-question-injection.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_TARGET_WORDS = 49;
const MINIMUM_STUDY_READY_WORDS = 20;
const OEWN_SOURCE = "Open English WordNet 2025";
const OEWN_PROVENANCE = "CC BY 4.0";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizedTokens(value) {
  return value.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
}

function tokenMatchesHeadword(token, headword) {
  if (token === headword) return true;
  const suffixes = ["s", "es", "ed", "ing", "ly", "er", "est", "ness", "ment", "tion", "al"];
  if (token.startsWith(headword) && suffixes.includes(token.slice(headword.length))) return true;
  if (headword.endsWith("e") && token.startsWith(headword.slice(0, -1)) && ["ing", "ed"].includes(token.slice(headword.length - 1))) return true;
  if (headword.endsWith("y") && token.startsWith(headword.slice(0, -1)) && ["ies", "ied"].includes(token.slice(headword.length - 1))) return true;
  const final = headword.at(-1);
  return Boolean(final && token.startsWith(`${headword}${final}`) && ["ed", "ing"].includes(token.slice(headword.length + 1)));
}

function exampleContainsHeadword(example, headword) {
  const normalized = headword.trim().toLowerCase();
  if (!normalized) return false;
  if (/[^a-z]/.test(normalized)) return example.text.toLowerCase().includes(normalized);
  return normalizedTokens(example.text).some((token) => tokenMatchesHeadword(token, normalized));
}

/**
 * Return only a Chinese Open Wordnet lemma that is explicitly marked as an
 * exact match to the selected English sense. Broader overlap labels such as
 * `lemma-in-gloss` are deliberately excluded: they are useful audit evidence,
 * but they are not safe public definitions on their own.
 */
export function extractExactCowAlignment(sense) {
  if (sense?.alignmentState !== "verified") return undefined;
  const match = sense.alignmentSource?.match(/^Chinese Open Wordnet 1\.4 via CILI (i\d+); exact: (.+)$/);
  if (!match) return undefined;
  const definitionZh = match[2].replaceAll("+", "").trim();
  if (!/[\u3400-\u9fff]/u.test(definitionZh)) return undefined;
  return { ili: match[1], definitionZh };
}

function openDictionaryExamples(word, sense) {
  return (sense.examples ?? []).filter((example) => (
    example.kind === "dictionary"
    && example.reviewState === "source_verified"
    && example.sourceLabel === OEWN_SOURCE
    && example.provenance === OEWN_PROVENANCE
    && example.rightsState === "open_reuse"
    && example.allowedIn?.includes("public")
    && example.sourceUrl === "https://en-word.net/"
    && Boolean(example.text?.trim())
    && exampleContainsHeadword(example, word.normalizedHeadword)
  ));
}

export function hasVerifiedOewnRelations(sense) {
  const kindChecked = (kind) => {
    const state = sense?.relationEvidence?.[kind]?.state;
    const values = sense?.relations?.[kind] ?? [];
    return (state === "verified_present" && values.length > 0)
      || (state === "source_checked_absent" && values.length === 0);
  };
  return sense?.relationState === "verified"
    && /^Open English WordNet 2025 synset \S+ \(CC BY 4\.0\)$/.test(sense.relationSource ?? "")
    && kindChecked("synonyms")
    && kindChecked("antonyms");
}

function candidateFrom(word) {
  const sense = word.senses?.[0];
  if (sense?.studyReviewState === "excluded") return undefined;
  if (sense?.quizRole === "distractor_only") return undefined;
  const alignment = extractExactCowAlignment(sense);
  if (!alignment || !sense.definitionEn?.trim()) return undefined;
  if (!word.pronunciations?.some(isTrustedPronunciation)) return undefined;
  if (!sensePartOfSpeechMatches(sense.partOfSpeech, sense.openSenseId)) return undefined;
  if (!hasVerifiedOewnRelations(sense)) return undefined;
  const examples = openDictionaryExamples(word, sense);
  if (!examples.length) return undefined;
  return { word, sense, alignment, examples };
}

function compareCandidates(left, right) {
  return (
    right.word.frequencyProfile.priorityScore - left.word.frequencyProfile.priorityScore
    || left.word.normalizedHeadword.localeCompare(right.word.normalizedHeadword, "en")
  );
}

function selectCandidates(candidates, targetSize) {
  const target = Math.min(targetSize, candidates.length);
  const focus = candidates.filter(({ word }) => word.frequencyProfile.tier === "focus").sort(compareCandidates);
  const longTail = candidates.filter(({ word }) => word.frequencyProfile.tier !== "focus").sort(compareCandidates);
  const focusTarget = Math.min(Math.round(target * 0.7), focus.length);
  const longTailTarget = Math.min(target - focusTarget, longTail.length);
  const selected = [...focus.slice(0, focusTarget), ...longTail.slice(0, longTailTarget)];
  const selectedIds = new Set(selected.map(({ word }) => word.id));
  const shortfall = target - selected.length;
  if (shortfall > 0) {
    selected.push(...candidates.filter(({ word }) => !selectedIds.has(word.id)).sort(compareCandidates).slice(0, shortfall));
  }
  return selected.sort((left, right) => left.word.normalizedHeadword.localeCompare(right.word.normalizedHeadword, "en"));
}

function publicAudioSources(word) {
  return (word.audioSources ?? []).filter((audio) => (
    audio.human === true
    && Boolean(audio.url && audio.sourcePageUrl && audio.creator && audio.license && audio.licenseUrl)
    && allowedCommonsLicense(audio.license)
    && englishAudioEvidence(audio.fileTitle, audio.languageCode ? { LanguageCode: audio.languageCode } : {}).accepted
  ));
}

export function buildOpenDemoCatalog(personal, options = {}) {
  const targetSize = options.targetSize ?? DEFAULT_TARGET_WORDS;
  const minimumStudyReady = options.minimumStudyReady ?? MINIMUM_STUDY_READY_WORDS;
  const candidates = personal.words.map(candidateFrom).filter(Boolean);
  const selected = selectCandidates(candidates, targetSize);
  const generatedAt = personal.generatedAt ?? "2026-07-13T00:00:00.000Z";
  const selectedSenseItems = new Map(selected.map(({ word, sense }) => [sense.id, { word, sense }]));

  const words = selected.map(({ word, sense, alignment, examples }, index) => {
    const publicSense = stripPrivateGreQuestionFields(sense);
    return {
      ...word,
      audioSources: publicAudioSources(word),
      senses: [{
        ...publicSense,
        relations: {
          ...publicSense.relations,
          confusables: [...new Set((publicSense.confusableSenseIds ?? [])
            .map((senseId) => selectedSenseItems.get(senseId)?.word.normalizedHeadword)
            .filter(Boolean))],
        },
        confusableSenseIds: (publicSense.confusableSenseIds ?? []).filter((senseId) => selectedSenseItems.has(senseId)),
        confusableRationales: Object.fromEntries(Object.entries(publicSense.confusableRationales ?? {})
          .filter(([senseId]) => selectedSenseItems.has(senseId))),
        confusableSource: (publicSense.confusableSenseIds ?? []).some((senseId) => selectedSenseItems.has(senseId))
          ? publicSense.confusableSource ?? ""
          : "",
        definitionZh: alignment.definitionZh,
        sourceLabel: `Chinese Open Wordnet 1.4 (${alignment.ili}) / Open English WordNet 2025`,
        usageNote: "",
        contextNote: "",
        examples,
      }],
      sourceFiles: ["Chinese Open Wordnet 1.4", "Open English WordNet 2025", "CMUdict"],
      initialLapses: 0,
      sourceConsensus: false,
      frequencyProfile: {
        tier: word.frequencyProfile.tier === "focus" ? "focus" : "long-tail",
        rank: index + 1,
        priorityScore: word.frequencyProfile.tier === "focus" ? 70 : 30,
        localMaterialCount: 0,
        officialMaterialCount: 0,
        evidenceBySource: {},
      },
      createdAt: generatedAt,
      updatedAt: generatedAt,
    };
  });

  const studyReadyPrimaryWords = words.filter((word) => (
    extractExactCowAlignment(word.senses[0])
    && word.pronunciations.some(isTrustedPronunciation)
    && sensePartOfSpeechMatches(word.senses[0].partOfSpeech, word.senses[0].openSenseId)
    && hasVerifiedOewnRelations(word.senses[0])
    && openDictionaryExamples(word, word.senses[0]).length > 0
  )).length;

  assert(studyReadyPrimaryWords === words.length, "Open demo contains a primary sense that fails the open-content study gate");
  assert(words.every((word) => hasVerifiedOewnRelations(word.senses[0])), "Open demo contains unverified or unsourced lexical relations");
  assert(studyReadyPrimaryWords >= minimumStudyReady, `Open demo needs at least ${minimumStudyReady} study-ready primary words; found ${studyReadyPrimaryWords}`);

  const catalog = {
    schemaVersion: 2,
    catalogVersion: "2026.07.13-open-demo.7",
    generatedAt,
    visibility: "public-open-demo",
    samplingPolicy: { focusShare: 0.7, longTailShare: 0.3, description: "Open demonstration catalog with sense-aligned dictionary examples." },
    provenance: [
      { id: "cmudict", label: "CMU Pronouncing Dictionary", url: "https://github.com/cmusphinx/cmudict", license: "CMUdict permissive notice" },
      { id: "oewn-2025", label: "Open English WordNet 2025", url: "https://en-word.net/", license: "CC BY 4.0" },
      { id: "omw-cmn-1.4", label: "Chinese Open Wordnet 1.4", url: "https://omwn.org/omw1.html", license: "WordNet license; Francis Bond & Shan Wang 2013, 2014" },
      { id: "lingua-libre", label: "Lingua Libre recordings via Wikimedia Commons", url: "https://commons.wikimedia.org/wiki/Category:Lingua_Libre_pronunciation-eng", license: "Per-file open license" },
    ],
    words,
  };
  assertNoPrivateGreQuestionLeak(catalog, "open demo catalog");
  return catalog;
}

async function main() {
  const personal = JSON.parse(await fs.readFile(path.join(root, "public/data/catalog.personal.json"), "utf8"));
  const catalog = buildOpenDemoCatalog(personal);
  const output = path.join(root, "public/data/catalog.open.json");
  await fs.writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`);
  const focus = catalog.words.filter((word) => word.frequencyProfile.tier === "focus").length;
  console.log(JSON.stringify({ output, words: catalog.words.length, studyReadyPrimaryWords: catalog.words.length, focus, longTail: catalog.words.length - focus }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
