import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertCatalogFileBoundary,
  buildOutputDirectory,
  enforceBuildOutputCatalogBoundary,
  parseBuildVisibility,
} from "./build-visibility.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function outputFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gre-build-boundary-"));
  temporaryDirectories.push(root);
  const output = path.join(root, "dist", "open");
  await fs.mkdir(path.join(output, "data"), { recursive: true });
  return { root, output };
}

describe("visibility-isolated build outputs", () => {
  it("requires an explicit build mode and assigns independent output directories", () => {
    expect(() => parseBuildVisibility([])).toThrow(/must be explicit/);
    expect(parseBuildVisibility(["--mode=open"])).toBe("open");
    expect(parseBuildVisibility(["--mode=personal"])).toBe("personal");
    expect(buildOutputDirectory("/project", "open")).toBe(path.join("/project", "dist", "open"));
    expect(buildOutputDirectory("/project", "personal")).toBe(path.join("/project", "dist", "personal"));
  });

  it("rejects an open artifact that contains or is missing the wrong catalog", () => {
    expect(() => assertCatalogFileBoundary("open", ["index.html", "data/catalog.open.json"])).not.toThrow();
    expect(() => assertCatalogFileBoundary("open", ["data/catalog.open.json", "data/catalog.personal.json"])).toThrow(/forbidden catalog.personal/);
    expect(() => assertCatalogFileBoundary("open", ["index.html"])).toThrow(/missing data\/catalog.open/);
  });

  it("removes the other catalog and validates the selected open catalog before packaging", async () => {
    const { output } = await outputFixture();
    await fs.writeFile(path.join(output, "index.html"), "<!doctype html>");
    await fs.writeFile(path.join(output, "data", "catalog.open.json"), JSON.stringify({
      schemaVersion: 2,
      catalogVersion: "test-open",
      visibility: "public-open-demo",
      words: [{ id: "word-open" }],
    }));
    await fs.writeFile(path.join(output, "data", "catalog.personal.json"), JSON.stringify({
      visibility: "private-local-build",
      greQuestionCorpusStats: { selectedMatches: 1 },
    }));

    await expect(enforceBuildOutputCatalogBoundary(output, "open")).resolves.toMatchObject({
      catalog: { visibility: "public-open-demo" },
    });
    await expect(fs.stat(path.join(output, "data", "catalog.personal.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails an open build when private GRE data was serialized into the open catalog", async () => {
    const { output } = await outputFixture();
    await fs.writeFile(path.join(output, "data", "catalog.open.json"), JSON.stringify({
      visibility: "public-open-demo",
      greQuestionCorpusStats: { reviewedBindings: 1 },
      words: [],
    }));
    await expect(enforceBuildOutputCatalogBoundary(output, "open")).rejects.toThrow(/private GRE question data/);
  });
});
