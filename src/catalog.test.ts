import { describe, expect, it } from "vitest";
import { catalogPathsForBuildMode } from "./catalog";

describe("catalog build-mode boundary", () => {
  it("never requests the personal catalog from an open build", () => {
    expect(catalogPathsForBuildMode("open")).toEqual(["data/catalog.open.json"]);
    expect(catalogPathsForBuildMode("open")).not.toContain("data/catalog.personal.json");
  });

  it("does not silently fall back from a personal build to the open catalog", () => {
    expect(catalogPathsForBuildMode("personal")).toEqual(["data/catalog.personal.json"]);
  });
});
