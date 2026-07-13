import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowedCommonsLicense, englishAudioEvidence } from "./lib/commons-audio-policy.mjs";
import {
  isTrustedAlignmentRecord,
  isTrustedPronunciation,
  sensePartOfSpeechMatches,
} from "./lib/content-quality.mjs";
import { assertNoPrivateGreQuestionLeak } from "./lib/private-gre-question-injection.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const exampleRightsStates = new Set(["open_reuse", "project_owned", "permission_granted", "private_user_held", "restricted", "unknown"]);
const exampleScopes = new Set(["public", "private"]);
const relationStates = new Set(["verified", "user_supplied", "unverified"]);
const relationCoverageStates = new Set(["verified_present", "source_checked_absent", "unverified"]);
const pronunciationQualities = new Set(["dictionary_ipa", "editor_reviewed", "approximate_transcription"]);
const pronunciationReviewStates = new Set(["source_verified", "editor_reviewed", "auto_transcribed"]);
const studyReviewStates = new Set(["unreviewed", "editor_approved", "excluded"]);
const quizRoles = new Set(["target_and_distractor", "distractor_only"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizedTokens(value) {
  return value.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
}

function exampleContainsHeadword(example, headword) {
  return normalizedTokens(example.text).some((token) => (
    token === headword
    || (token.startsWith(headword) && ["s", "es", "ed", "ing", "ly", "er", "est", "ness", "ment", "tion", "al"].includes(token.slice(headword.length)))
    || (headword.endsWith("e") && token.startsWith(headword.slice(0, -1)) && ["ing", "ed"].includes(token.slice(headword.length - 1)))
    || (headword.endsWith("y") && token.startsWith(headword.slice(0, -1)) && ["ies", "ied"].includes(token.slice(headword.length - 1)))
    || (headword.at(-1) && token.startsWith(`${headword}${headword.at(-1)}`) && ["ed", "ing"].includes(token.slice(headword.length + 1)))
  ));
}

function openPrimarySenseReady(word) {
  const sense = word.senses[0];
  if (sense?.studyReviewState === "excluded") return false;
  const match = sense?.alignmentSource?.match(/^Chinese Open Wordnet 1\.4 via CILI i\d+; exact: (.+)$/);
  if (sense?.alignmentState !== "verified" || !match) return false;
  if (sense.definitionZh !== match[1].replaceAll("+", "").trim()) return false;
  if (!word.pronunciations.some(isTrustedPronunciation)) return false;
  if (!sensePartOfSpeechMatches(sense.partOfSpeech, sense.openSenseId)) return false;
  if (sense.relationState !== "verified") return false;
  if (!/^Open English WordNet 2025 synset \S+ \(CC BY 4\.0\)$/.test(sense.relationSource ?? "")) return false;
  if (sense.relationEvidence?.synonyms?.state !== (sense.relations.synonyms.length ? "verified_present" : "source_checked_absent")) return false;
  if (sense.relationEvidence?.antonyms?.state !== (sense.relations.antonyms.length ? "verified_present" : "source_checked_absent")) return false;
  return sense.examples.some((example) => (
    example.kind === "dictionary"
    && example.sourceLabel === "Open English WordNet 2025"
    && example.sourceUrl === "https://en-word.net/"
    && example.provenance === "CC BY 4.0"
    && example.reviewState === "source_verified"
    && example.rightsState === "open_reuse"
    && example.allowedIn?.includes("public")
    && exampleContainsHeadword(example, word.normalizedHeadword)
  ));
}

function validate(catalog, label) {
  assert(catalog.schemaVersion === 2, `${label}: schemaVersion must be 2`);
  assert(catalog.catalogVersion, `${label}: catalogVersion missing`);
  assert(catalog.words.length > 0, `${label}: no words`);
  assert(new Set(catalog.words.map((word) => word.id)).size === catalog.words.length, `${label}: duplicate word IDs`);
  assert(new Set(catalog.words.map((word) => word.normalizedHeadword)).size === catalog.words.length, `${label}: duplicate headwords`);
  const itemBySenseId = new Map(catalog.words.flatMap((word) => word.senses.map((sense) => [sense.id, { word, sense }])));
  for (const word of catalog.words) {
    assert(word.senses.length > 0, `${label}: ${word.headword} has no senses`);
    assert(Array.isArray(word.audioSources), `${label}: ${word.headword} has no audio source list`);
    for (const pronunciation of word.pronunciations) {
      assert(pronunciation.ipa?.trim(), `${label}: ${word.headword} has an empty pronunciation`);
      assert(pronunciationQualities.has(pronunciation.quality), `${label}: ${word.headword} has an invalid pronunciation quality`);
      assert(pronunciationReviewStates.has(pronunciation.reviewState), `${label}: ${word.headword} has an invalid pronunciation review state`);
      if (pronunciation.quality === "dictionary_ipa") assert(pronunciation.reviewState === "source_verified", `${label}: ${word.headword} dictionary IPA is not source verified`);
      if (pronunciation.quality === "editor_reviewed") assert(pronunciation.reviewState === "editor_reviewed", `${label}: ${word.headword} editorial IPA lacks editorial review`);
      if (pronunciation.quality === "approximate_transcription") assert(pronunciation.reviewState === "auto_transcribed", `${label}: ${word.headword} approximate IPA has an invalid review state`);
    }
    for (const audio of word.audioSources) {
      if (!audio.human) continue;
      assert(/^https:\/\/upload\.wikimedia\.org\//i.test(audio.url ?? ""), `${label}: ${word.headword} human audio has an invalid media URL`);
      assert(/^https:\/\/commons\.wikimedia\.org\//i.test(audio.sourcePageUrl ?? ""), `${label}: ${word.headword} human audio has an invalid source page URL`);
      assert(audio.creator?.trim(), `${label}: ${word.headword} human audio has no creator`);
      assert(/^https?:\/\//i.test(audio.licenseUrl ?? ""), `${label}: ${word.headword} human audio has no license URL`);
      assert(audio.dialect?.trim(), `${label}: ${word.headword} human audio has no dialect`);
      assert(allowedCommonsLicense(audio.license), `${label}: ${word.headword} human audio has a disallowed license: ${audio.license}`);
      const languageMetadata = audio.languageCode ? { LanguageCode: audio.languageCode } : {};
      const language = englishAudioEvidence(audio.fileTitle, languageMetadata);
      assert(language.accepted, `${label}: ${word.headword} human audio lacks explicit English evidence: ${audio.fileTitle}`);
      if (audio.languageCode) {
        assert(audio.languageCode === "en" && audio.languageEvidence?.trim(), `${label}: ${word.headword} human audio has incomplete English metadata evidence`);
      }
    }
    assert(["focus", "long-tail", "unranked"].includes(word.frequencyProfile.tier), `${label}: ${word.headword} has invalid tier`);
    for (const sense of word.senses) {
      assert(sense.definitionZh, `${label}: ${word.headword} has an empty Chinese definition`);
      assert(["verified", "candidate", "unverified"].includes(sense.alignmentState), `${label}: ${word.headword} has an invalid alignment state`);
      assert(Number.isFinite(sense.alignmentScore) && sense.alignmentScore >= 0 && sense.alignmentScore <= 1, `${label}: ${word.headword} has an invalid alignment score`);
      assert(sense.alignmentSource?.trim(), `${label}: ${word.headword} has no alignment source`);
      assert(studyReviewStates.has(sense.studyReviewState), `${label}: ${word.headword} has an invalid study review state`);
      assert(typeof sense.studyReviewNote === "string", `${label}: ${word.headword} has no study review note`);
      assert(quizRoles.has(sense.quizRole ?? "target_and_distractor"), `${label}: ${word.headword} has an invalid quiz role`);
      if (sense.alignmentState === "verified") {
        assert(isTrustedAlignmentRecord(sense), `${label}: ${word.headword} has a heuristic alignment marked verified`);
        assert(sensePartOfSpeechMatches(sense.partOfSpeech, sense.openSenseId), `${label}: ${word.headword} verified POS does not match its OEWN sense key`);
      }
      assert(relationStates.has(sense.relationState), `${label}: ${word.headword} has an invalid relation state`);
      assert(Array.isArray(sense.relations.confusables), `${label}: ${word.headword} has no confusable list`);
      const confusableSenseIds = sense.confusableSenseIds ?? [];
      const confusableRationales = sense.confusableRationales ?? {};
      assert(Array.isArray(confusableSenseIds), `${label}: ${word.headword} has an invalid exact-confusable list`);
      assert(confusableRationales && typeof confusableRationales === "object" && !Array.isArray(confusableRationales), `${label}: ${word.headword} has invalid confusable rationales`);
      assert(new Set(confusableSenseIds).size === confusableSenseIds.length, `${label}: ${word.headword} repeats an exact confusable sense`);
      assert(new Set(sense.relations.confusables).size === sense.relations.confusables.length, `${label}: ${word.headword} repeats a confusable headword`);
      assert(confusableSenseIds.length === sense.relations.confusables.length, `${label}: ${word.headword} confusable headwords are not bound one-to-one to exact senses`);
      for (const [index, candidateSenseId] of confusableSenseIds.entries()) {
        const candidate = itemBySenseId.get(candidateSenseId);
        assert(candidate, `${label}: ${word.headword} references a missing confusable sense ${candidateSenseId}`);
        assert(candidate.word.id !== word.id, `${label}: ${word.headword} references itself as a confusable`);
        assert(
          candidate.word.normalizedHeadword === sense.relations.confusables[index],
          `${label}: ${word.headword} confusable headword does not match its exact sense`,
        );
      }
      if (confusableSenseIds.length) {
        assert(sense.alignmentState === "verified", `${label}: ${word.headword} has editorial confusables on an unverified sense`);
        assert(sense.confusableSource?.trim(), `${label}: ${word.headword} has exact confusables without a review source`);
        assert(Object.keys(confusableRationales).length === confusableSenseIds.length, `${label}: ${word.headword} has incomplete confusable rationales`);
        for (const senseId of confusableSenseIds) {
          assert(confusableRationales[senseId]?.trim(), `${label}: ${word.headword} has no rationale for ${senseId}`);
        }
      } else {
        assert(!sense.confusableSource, `${label}: ${word.headword} retains a confusable source without exact targets`);
        assert(Object.keys(confusableRationales).length === 0, `${label}: ${word.headword} retains rationales without exact targets`);
      }
      if (sense.quizRole === "distractor_only") {
        assert(confusableSenseIds.length === 0, `${label}: ${word.headword} distractor-only sense retained target confusables`);
      }
      if (label === "open") assert(sense.quizRole !== "distractor_only", `open: ${word.headword} contains a distractor-only primary sense`);
      if (label === "open") {
        assert(!Object.hasOwn(sense, "greQuestionMatches"), `open: ${word.headword} retained private GRE question matches`);
        assert(!Object.hasOwn(sense, "greQuestionMatchStats"), `open: ${word.headword} retained private GRE question statistics`);
      }
      assert(sense.relationSource?.trim(), `${label}: ${word.headword} has no relation source`);
      assert(sense.relationEvidence && typeof sense.relationEvidence === "object", `${label}: ${word.headword} has no per-kind relation evidence`);
      for (const [kind, values] of [["synonyms", sense.relations.synonyms], ["antonyms", sense.relations.antonyms]]) {
        const detail = sense.relationEvidence?.[kind];
        assert(relationCoverageStates.has(detail?.state), `${label}: ${word.headword} has an invalid ${kind} evidence state`);
        assert(detail?.source?.trim(), `${label}: ${word.headword} has no ${kind} evidence source`);
        if (detail.state === "verified_present") assert(values.length > 0, `${label}: ${word.headword} marks ${kind} present but has no values`);
        if (detail.state === "source_checked_absent") assert(values.length === 0, `${label}: ${word.headword} marks ${kind} absent but retains values`);
        if (detail.state === "verified_present" || detail.state === "source_checked_absent") {
          assert(sense.alignmentState === "verified", `${label}: ${word.headword} has checked ${kind} evidence on an unverified sense`);
          const sourcePattern = kind === "synonyms"
            ? /^Open English WordNet 2025 synset \S+ members \(CC BY 4\.0\)$/
            : /^Open English WordNet 2025 lexical sense \S+ antonym relation \(CC BY 4\.0\)$/;
          assert(sourcePattern.test(detail.source), `${label}: ${word.headword} has an invalid ${kind} evidence source`);
        }
      }
      if (sense.relationState === "verified") {
        assert(sense.alignmentState === "verified", `${label}: ${word.headword} has verified relations on an unverified sense`);
        assert(/^Open English WordNet 2025 synset \S+ \(CC BY 4\.0\)$/.test(sense.relationSource), `${label}: ${word.headword} verified relations lack an exact OEWN source`);
        assert(
          sense.relationEvidence.synonyms.state !== "unverified" && sense.relationEvidence.antonyms.state !== "unverified",
          `${label}: ${word.headword} has verified aggregate relations without both per-kind checks`,
        );
      } else {
        assert(!sense.relations.synonyms.length && !sense.relations.antonyms.length, `${label}: ${word.headword} unverified static relations were retained`);
        assert(
          sense.relationEvidence.synonyms.state === "unverified" && sense.relationEvidence.antonyms.state === "unverified",
          `${label}: ${word.headword} has checked per-kind relation evidence but an unverified aggregate state`,
        );
      }
      if (label === "open") assert(sense.relationState === "verified", `open: ${word.headword} has non-verified relations`);
      for (const example of sense.examples) {
        assert(typeof example.text === "string", `${label}: ${word.headword} has a non-string example`);
        assert(exampleRightsStates.has(example.rightsState), `${label}: ${word.headword} example has invalid or missing rightsState`);
        assert(Array.isArray(example.allowedIn) && example.allowedIn.every((scope) => exampleScopes.has(scope)), `${label}: ${word.headword} example has invalid or missing allowedIn scopes`);
        if (example.kind === "original_gre_style") {
          assert(example.sourceLocator === sense.openSenseId, `${label}: ${word.headword} has an unbound original context`);
          assert(
            sense.studyReviewState !== "excluded" && isTrustedAlignmentRecord(sense),
            `${label}: ${word.headword} original context is bound to an untrusted sense`,
          );
        }
        if (label === "open") {
          assert(example.allowedIn.includes("public"), `open: ${word.headword} example is not approved for public use`);
          assert(["open_reuse", "project_owned"].includes(example.rightsState), `open: ${word.headword} example has non-public rights state`);
          assert(!["gre_official", "screen_dialogue", "private_reference"].includes(example.kind), `open: ${word.headword} contains a non-public example kind`);
        }
      }
    }
  }
  const pronunciation = catalog.words.filter((word) => word.pronunciations.length).length;
  const humanAudio = catalog.words.filter((word) => word.audioSources.some((audio) => audio.human && audio.url && audio.sourcePageUrl && audio.license && audio.licenseUrl && audio.creator)).length;
  const relations = catalog.words.filter((word) => word.senses.some((sense) => (
    sense.relationState === "verified" && (sense.relations.synonyms.length || sense.relations.antonyms.length)
  ))).length;
  const contexts = catalog.words.filter((word) => word.senses.some((sense) => sense.examples.length)).length;
  const editorialContexts = catalog.words.filter((word) => word.senses.some((sense) => sense.examples.some((example) => example.kind === "original_gre_style"))).length;
  const verifiedAlignment = catalog.words.filter((word) => word.senses.some((sense) => sense.alignmentState === "verified")).length;
  return {
    label,
    version: catalog.catalogVersion,
    words: catalog.words.length,
    senses: catalog.words.reduce((sum, word) => sum + word.senses.length, 0),
    pronunciation,
    humanAudio,
    relations,
    contexts,
    editorialContexts,
    verifiedAlignment,
  };
}

const personal = JSON.parse(await fs.readFile(path.join(root, "public/data/catalog.personal.json"), "utf8"));
const open = JSON.parse(await fs.readFile(path.join(root, "public/data/catalog.open.json"), "utf8"));
const personalReport = validate(personal, "personal");
const openReport = validate(open, "open");
assert(personalReport.words === 2_535, "personal: expected 2,535 core words");
const acclaim = personal.words.find((word) => word.normalizedHeadword === "acclaim");
const acclaimSense = acclaim?.senses.find((sense) => sense.openSenseId === "acclaim%1:10:00::");
assert(acclaim?.pronunciations.some((item) => (
  item.ipa === "əˈkleɪm"
  && item.dialect === "US"
  && item.reviewState === "source_verified"
  && /oldid=91139541/.test(item.sourceUrl ?? "")
)), "personal: acclaim lost its source-pinned US IPA");
assert(acclaimSense?.relationEvidence?.antonyms?.state === "source_checked_absent", "personal: acclaim antonym absence is no longer source checked");
assert(acclaimSense?.relations.antonyms.length === 0, "personal: acclaim fabricated a direct antonym");
assert(personalReport.pronunciation / personalReport.words >= 0.95, "personal: pronunciation coverage below 95%");
// Conservative review can intentionally reduce coverage. These guards catch a
// broken enrichment pipeline without pressuring the build to relabel heuristic
// candidates as verified merely to hit an old percentage target.
assert(personalReport.relations / personalReport.words >= 0.15, "personal: verified relation coverage below 15%");
assert(personalReport.verifiedAlignment / personalReport.words >= 0.15, "personal: verified word alignment coverage below 15%");
for (const headword of ["petty", "scrupulous", "treacherous"]) {
  const word = personal.words.find((candidate) => candidate.normalizedHeadword === headword);
  assert(
    word?.senses.some((sense) => (
      sense.studyReviewState === "editor_approved"
      && sense.examples.some((example) => example.kind === "dictionary" && exampleContainsHeadword(example, headword))
    )),
    `personal: ${headword} lost its target-bearing OEWN example`,
  );
}
assert(open.words.every((word) => !word.sourceFiles.some((source) => /\.xlsx|private_user_held|restricted_source/i.test(source))), "open: private source label leaked");
assert(open.words.every((word) => word.senses.every((sense) => !/\.xlsx|private_user_held|restricted_source/i.test(sense.sourceLabel))), "open: private sense source leaked");
assertNoPrivateGreQuestionLeak(open, "open catalog serialization");
assert(!/\.xlsx|gre_official|screen_dialogue|private_user_held|restricted_source/i.test(JSON.stringify(open)), "open: serialized catalog contains a private or restricted marker");
assert(openReport.words >= 20, "open: at least 20 study-ready primary words are required");
assert(open.words.every(openPrimarySenseReady), "open: every primary sense must use an exact COW lemma and an aligned, public OEWN example");
console.log(JSON.stringify({ personal: personalReport, open: openReport }, null, 2));
