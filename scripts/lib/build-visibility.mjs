import fs from "node:fs/promises";
import path from "node:path";
import { assertNoPrivateGreQuestionLeak } from "./private-gre-question-injection.mjs";

export const BUILD_VISIBILITIES = Object.freeze(["open", "personal"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function normalizeBuildVisibility(value) {
  assert(BUILD_VISIBILITIES.includes(value), `Build visibility must be explicit: ${BUILD_VISIBILITIES.join(" or ")}`);
  return value;
}

export function catalogNameForVisibility(visibility) {
  return normalizeBuildVisibility(visibility) === "open" ? "catalog.open.json" : "catalog.personal.json";
}

export function buildOutputDirectory(projectRoot, visibility) {
  return path.join(projectRoot, "dist", normalizeBuildVisibility(visibility));
}

export function parseBuildVisibility(argv) {
  const explicit = argv.find((argument) => argument.startsWith("--mode="))?.slice("--mode=".length);
  return normalizeBuildVisibility(explicit);
}

export function assertCatalogFileBoundary(visibility, relativeFiles) {
  const mode = normalizeBuildVisibility(visibility);
  const normalizedFiles = relativeFiles.map((file) => file.replaceAll("\\", "/"));
  const expected = `data/${catalogNameForVisibility(mode)}`;
  const forbidden = mode === "open" ? "catalog.personal.json" : "catalog.open.json";
  assert(normalizedFiles.includes(expected), `${mode} build is missing ${expected}`);
  assert(!normalizedFiles.some((file) => path.posix.basename(file) === forbidden), `${mode} build contains forbidden ${forbidden}`);
}

async function relativeFilesUnder(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute));
    }
  }
  await visit(root);
  return files;
}

/**
 * Vite copies the whole public directory. Delete the catalog for the other
 * visibility before the build can be packaged, then assert the resulting
 * output contains exactly the catalog selected by the explicit build mode.
 */
export async function enforceBuildOutputCatalogBoundary(outputDirectory, visibility) {
  const mode = normalizeBuildVisibility(visibility);
  const forbiddenName = mode === "open" ? "catalog.personal.json" : "catalog.open.json";
  await fs.rm(path.join(outputDirectory, "data", forbiddenName), { force: true });
  const relativeFiles = await relativeFilesUnder(outputDirectory);
  assertCatalogFileBoundary(mode, relativeFiles);

  const catalogPath = path.join(outputDirectory, "data", catalogNameForVisibility(mode));
  const catalogText = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(catalogText);
  if (mode === "open") {
    assert(catalog.visibility === "public-open-demo", "Open build did not receive the public-open-demo catalog");
    assertNoPrivateGreQuestionLeak(catalog, "open build catalog");
  } else {
    assert(catalog.visibility === "private-local-build", "Personal build did not receive the private-local-build catalog");
  }
  return { catalog, catalogPath, relativeFiles };
}
