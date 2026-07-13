import { describe, expect, it } from "vitest";
import {
  isTrustedAlignmentRecord,
  isTrustedPronunciation,
  partOfSpeechFromSenseKey,
  sensePartOfSpeechMatches,
  strictAutomaticAlignmentState,
} from "./content-quality.mjs";

describe("formal content quality policy", () => {
  it("keeps exact COW matches verified and downgrades gloss heuristics", () => {
    expect(strictAutomaticAlignmentState({ state: "verified", matchType: "exact" })).toBe("verified");
    expect(strictAutomaticAlignmentState({ state: "verified", matchType: "lemma-in-gloss" })).toBe("candidate");
    expect(strictAutomaticAlignmentState({ state: "verified", matchType: "gloss-in-lemma" })).toBe("candidate");
    expect(strictAutomaticAlignmentState({ state: "missing", matchType: "none" })).toBe("unverified");
  });

  it("accepts only explicit exact or editorial alignment records", () => {
    expect(isTrustedAlignmentRecord({ alignmentState: "verified", alignmentSource: "Chinese Open Wordnet 1.4 via CILI i1; exact: 称赞" })).toBe(true);
    expect(isTrustedAlignmentRecord({ alignmentState: "verified", alignmentSource: "GRE Verbal Lab editorial review; OEWN sense acclaim%1:10:00::" })).toBe(true);
    expect(isTrustedAlignmentRecord({ alignmentState: "verified", alignmentSource: "Chinese Open Wordnet 1.4 via CILI i1; lemma-in-gloss: 赞扬" })).toBe(false);
  });

  it("does not trust approximate ARPAbet conversion as dictionary IPA", () => {
    expect(isTrustedPronunciation({ ipa: "əˈkleɪm", quality: "dictionary_ipa", reviewState: "source_verified" })).toBe(true);
    expect(isTrustedPronunciation({ ipa: "əklˈeɪm", quality: "approximate_transcription", reviewState: "auto_transcribed" })).toBe(false);
  });

  it("derives and validates POS from OEWN sense keys", () => {
    expect(partOfSpeechFromSenseKey("acclaim%1:10:00::")).toBe("n.");
    expect(partOfSpeechFromSenseKey("acclaim%2:32:00::")).toBe("v.");
    expect(sensePartOfSpeechMatches("vt.", "acclaim%2:32:00::")).toBe(true);
    expect(sensePartOfSpeechMatches("n.", "acclaim%2:32:00::")).toBe(false);
  });
});
