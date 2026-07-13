import { describe, expect, it } from "vitest";
import { selectDictionaryExampleTexts, textContainsHeadword } from "./dictionary-example-selection.mjs";

describe("OEWN dictionary example selection", () => {
  it("does not let two synonym examples displace a later target-headword example", () => {
    const selected = selectDictionaryExampleTexts([
      "The complaint was trivial.",
      "They argued over an insignificant detail.",
      "The petty dispute consumed the whole meeting.",
    ], "petty");

    expect(selected).toHaveLength(2);
    expect(selected[0]).toContain("petty");
    expect(selected[1]).toBe("The complaint was trivial.");
  });

  it("recognizes supported inflections without accepting substring lookalikes", () => {
    expect(textContainsHeadword("She studied the evidence carefully.", "study")).toBe(true);
    expect(textContainsHeadword("They were running the study.", "run")).toBe(true);
    expect(textContainsHeadword("His skill was obvious.", "ill")).toBe(false);
  });
});
