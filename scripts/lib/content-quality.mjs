const exactCowAlignmentPattern = /^Chinese Open Wordnet 1\.4 via CILI i\d+; exact: .+$/;
const editorialAlignmentPattern = /^GRE Verbal Lab editorial review\b/;

export const trustedPronunciationQualities = new Set(["dictionary_ipa", "editor_reviewed"]);

export function pronunciationQualityForSource(source) {
  if (source === "Open English WordNet 2025") return "dictionary_ipa";
  if (/editorial review/i.test(String(source ?? ""))) return "editor_reviewed";
  return "approximate_transcription";
}

export function isTrustedPronunciation(pronunciation) {
  if (!pronunciation?.ipa?.trim() || !trustedPronunciationQualities.has(pronunciation.quality)) return false;
  if (pronunciation.quality === "dictionary_ipa") return pronunciation.reviewState === "source_verified";
  return pronunciation.reviewState === "editor_reviewed";
}

export function strictAutomaticAlignmentState(automatic) {
  if (automatic?.state === "verified" && automatic.matchType === "exact") return "verified";
  if (automatic?.state === "missing") return "unverified";
  return "candidate";
}

export function isTrustedAlignmentRecord(sense) {
  if (sense?.alignmentState !== "verified") return false;
  return exactCowAlignmentPattern.test(sense.alignmentSource ?? "")
    || editorialAlignmentPattern.test(sense.alignmentSource ?? "");
}

export function partOfSpeechFromSenseKey(openSenseId) {
  const code = String(openSenseId ?? "").match(/%([1-5]):/)?.[1];
  if (code === "1") return "n.";
  if (code === "2") return "v.";
  if (code === "3" || code === "5") return "adj.";
  if (code === "4") return "adv.";
  return "";
}

export function partOfSpeechFamily(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.startsWith("n")) return "n";
  if (normalized.startsWith("v")) return "v";
  if (normalized.startsWith("adj") || normalized === "a." || normalized === "a") return "adj";
  if (normalized.startsWith("adv") || normalized === "r." || normalized === "r") return "adv";
  return "";
}

export function sensePartOfSpeechMatches(partOfSpeech, openSenseId) {
  const expected = partOfSpeechFamily(partOfSpeechFromSenseKey(openSenseId));
  return Boolean(expected && partOfSpeechFamily(partOfSpeech) === expected);
}
