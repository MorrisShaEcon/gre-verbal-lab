import fs from "node:fs/promises";
import { validateStandaloneHtml } from "./lib/standalone-validation.mjs";

const filePath = process.argv[2];
if (!filePath) throw new Error("Usage: node scripts/validate-standalone.mjs <html>");
const html = await fs.readFile(filePath, "utf8");
const catalog = validateStandaloneHtml(html);
console.log(JSON.stringify({ filePath, visibility: catalog.visibility, catalogVersion: catalog.catalogVersion, words: catalog.words.length }));
