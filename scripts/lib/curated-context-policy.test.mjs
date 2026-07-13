import { describe, expect, it } from "vitest";
import { findBoundCuratedContextSense } from "./curated-context-policy.mjs";

const verified = {
  id: "sense-acclaim-n",
  openSenseId: "acclaim%1:10:00::",
  alignmentState: "verified",
  alignmentSource: "Chinese Open Wordnet 1.4 via CILI i1; exact: 称赞",
  studyReviewState: "unreviewed",
};

describe("curated context binding", () => {
  it("rejects an unbound editorial sentence", () => {
    expect(findBoundCuratedContextSense([verified], { sentence: "The book won acclaim." })).toBeUndefined();
  });

  it("rejects a wrong, heuristic, or excluded sense binding", () => {
    expect(findBoundCuratedContextSense([verified], { openSenseId: "acclaim%2:32:00::", sentence: "Critics acclaimed it." })).toBeUndefined();
    expect(findBoundCuratedContextSense([{ ...verified, alignmentSource: "Chinese Open Wordnet 1.4 via CILI i1; lemma-in-gloss: 称赞" }], { openSenseId: verified.openSenseId, sentence: "The book won acclaim." })).toBeUndefined();
    expect(findBoundCuratedContextSense([{ ...verified, studyReviewState: "excluded" }], { openSenseId: verified.openSenseId, sentence: "The book won acclaim." })).toBeUndefined();
  });

  it("returns only an explicitly bound verified sense", () => {
    expect(findBoundCuratedContextSense([verified], { openSenseId: verified.openSenseId, sentence: "The book won acclaim." })?.id).toBe(verified.id);
  });
});
