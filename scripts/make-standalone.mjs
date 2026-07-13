import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOutputDirectory,
  catalogNameForVisibility,
  enforceBuildOutputCatalogBoundary,
  parseBuildVisibility,
} from "./lib/build-visibility.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const visibility = parseBuildVisibility(process.argv.slice(2));
const dist = buildOutputDirectory(root, visibility);
const { catalog } = await enforceBuildOutputCatalogBoundary(dist, visibility);
let html = await fs.readFile(path.join(dist, "index.html"), "utf8");
const scriptMatch = html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/);
const styleMatch = html.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/);

if (!scriptMatch || !styleMatch) throw new Error(`Built assets were not found in ${dist}/index.html`);

const scriptPath = path.join(dist, "assets", path.basename(scriptMatch[1]));
const stylePath = path.join(dist, "assets", path.basename(styleMatch[1]));
const [script, style, icon] = await Promise.all([
  fs.readFile(scriptPath, "utf8"),
  fs.readFile(stylePath, "utf8"),
  fs.readFile(path.join(dist, "icon-192.png")),
]);
const iconDataUrl = `data:image/png;base64,${icon.toString("base64")}`;
const catalogName = catalogNameForVisibility(visibility);
const catalogText = JSON.stringify(catalog);
const isPersonal = visibility === "personal";
const catalogScript = `<script>window.__GRE_CATALOG__=${catalogText.replaceAll("<", "\\u003c")}</script>`;

html = html
  .replace(styleMatch[0], () => `<style>${style}</style>`)
  .replace(scriptMatch[0], () => `${catalogScript}<script type="module">${script}</script>`)
  .replace(/\s*<link rel="manifest"[^>]*>/, "")
  .replace("<title>GRE Verbal Lab</title>", isPersonal ? "<title>GRE Verbal Lab v2.2.0 · 私人机经版</title>" : "<title>GRE Verbal Lab v2.2.0 · 开放版</title>")
  .replaceAll("/gre-verbal-lab/icon-192.png", iconDataUrl)
  .replaceAll("./icon-192.png", iconDataUrl);

if (/\b(?:src|href)="\/gre-verbal-lab\/assets\//.test(html)) {
  throw new Error("Standalone build still contains external asset references");
}
if (/\b(?:src|href)="(?:\.?\/|\/gre-verbal-lab\/)icon-192\.png"/.test(html)) {
  throw new Error("Standalone build still contains an external icon reference");
}

const output = path.join(dist, isPersonal ? "GRE-Verbal-Lab-PERSONAL-v2.2.0.html" : "GRE-Verbal-Lab-v2.2.0.html");
await fs.writeFile(output, html, "utf8");
console.log(`Standalone app (${catalogName}): ${output}`);
