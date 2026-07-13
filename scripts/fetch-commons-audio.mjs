import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowedCommonsLicense, dialectFromEnglishEvidence, englishAudioEvidence } from "./lib/commons-audio-policy.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogPath = path.join(root, "public/data/catalog.personal.json");
const cachePath = path.join(root, "data/cache/commons-audio-index.json");
const refresh = process.argv.includes("--refresh");
const sanitizeOnly = process.argv.includes("--sanitize-only");
const requestedLimit = Number(process.argv.find((value) => value.startsWith("--limit="))?.split("=")[1] ?? 0);
const batchSize = 40;
const userAgent = "GRE-Verbal-Lab/2.2 (https://github.com/MorrisShaEcon/gre-verbal-lab; personal vocabulary study app)";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function plainText(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function audioFile(title) {
  return /\.(?:wav|ogg|oga|mp3|flac)$/i.test(title);
}

function fallbackLicenseUrl(license) {
  if (/^CC0(?:\s|$)/i.test(license)) return "https://creativecommons.org/publicdomain/zero/1.0/";
  if (/^Public domain$/i.test(license)) return "https://creativecommons.org/publicdomain/mark/1.0/";
  const version = license.match(/(\d\.\d)/)?.[1] ?? "4.0";
  if (/^CC BY-SA(?:\s|$)/i.test(license)) return `https://creativecommons.org/licenses/by-sa/${version}/`;
  if (/^CC BY(?:\s|$)/i.test(license)) return `https://creativecommons.org/licenses/by/${version}/`;
  return "";
}

function audioScore(title, license) {
  let score = 0;
  if (/LL-Q1860 \(eng\)/i.test(title)) score += 50;
  if (/\ben-us\b/i.test(title)) score += 35;
  if (/\beng\b/i.test(title)) score += 15;
  if (/CC0/i.test(license)) score += 20;
  else if (/CC BY /i.test(license)) score += 12;
  else if (/CC BY-SA/i.test(license)) score += 8;
  if (/\.ogg$/i.test(title)) score += 4;
  return score;
}

async function requestJson(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("origin", "*");
  url.searchParams.set("maxlag", "5");
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "application/json" } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error.info ?? payload.error.code);
      return payload;
    } catch (error) {
      lastError = error;
      await sleep(600 * (attempt + 1));
    }
  }
  throw lastError;
}

async function loadCache() {
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath, "utf8"));
    return { schemaVersion: 1, generatedAt: parsed.generatedAt ?? null, words: parsed.words ?? {} };
  } catch {
    return { schemaVersion: 1, generatedAt: null, words: {} };
  }
}

const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
const cache = await loadCache();
const allHeadwords = catalog.words.map((word) => word.normalizedHeadword);
let pending = refresh ? allHeadwords : allHeadwords.filter((headword) => !(headword in cache.words));
if (sanitizeOnly) pending = [];
if (requestedLimit > 0) pending = pending.slice(0, requestedLimit);

for (const [batchIndex, headwords] of chunks(pending, batchSize).entries()) {
  const payload = await requestJson("https://en.wiktionary.org/w/api.php", {
    action: "query",
    prop: "images",
    imlimit: "max",
    redirects: "1",
    titles: headwords.join("|"),
  });
  const titlesByHeadword = new Map();
  for (const page of payload.query?.pages ?? []) {
    const normalizedTitle = String(page.title ?? "").trim().toLowerCase();
    if (!headwords.includes(normalizedTitle)) continue;
    titlesByHeadword.set(normalizedTitle, (page.images ?? []).map((image) => image.title).filter(audioFile));
  }
  for (const headword of headwords) cache.words[headword] = { files: titlesByHeadword.get(headword) ?? [], audio: [] };
  if ((batchIndex + 1) % 10 === 0 || batchIndex === chunks(pending, batchSize).length - 1) {
    process.stdout.write(`Wiktionary pages: ${Math.min((batchIndex + 1) * batchSize, pending.length)}/${pending.length}\n`);
  }
  await sleep(140);
}

const fileToWords = new Map();
for (const headword of allHeadwords) {
  for (const title of cache.words[headword]?.files ?? []) {
    fileToWords.set(title, [...(fileToWords.get(title) ?? []), headword]);
  }
}
const unresolvedFiles = (sanitizeOnly ? [] : [...fileToWords.keys()]).filter((title) => {
  const headword = fileToWords.get(title)?.[0];
  return !(cache.words[headword]?.audio ?? []).some((item) => item.fileTitle === title);
});

for (const [batchIndex, titles] of chunks(unresolvedFiles, batchSize).entries()) {
  const payload = await requestJson("https://commons.wikimedia.org/w/api.php", {
    action: "query",
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    titles: titles.join("|"),
  });
  for (const page of payload.query?.pages ?? []) {
    const info = page.imageinfo?.[0];
    if (!info?.url) continue;
    const metadata = info.extmetadata ?? {};
    const license = plainText(metadata.LicenseShortName?.value);
    const language = englishAudioEvidence(page.title, metadata);
    const creator = plainText(metadata.Artist?.value);
    const licenseUrl = plainText(metadata.LicenseUrl?.value) || fallbackLicenseUrl(license);
    if (!allowedCommonsLicense(license) || !language.accepted || !creator || !licenseUrl) continue;
    const item = {
      id: `commons-${page.pageid}`,
      fileTitle: page.title,
      url: info.url,
      sourcePageUrl: info.descriptionurl,
      sourceLabel: /Lingua Libre/i.test(plainText(metadata.ImageDescription?.value) + page.title)
        ? "Lingua Libre / Wikimedia Commons"
        : "Wikimedia Commons",
      creator,
      license,
      licenseUrl,
      dialect: dialectFromEnglishEvidence(page.title, metadata),
      languageCode: language.languageCode,
      languageEvidence: language.evidence,
      human: true,
      mimeType: info.mime ?? "audio/wav",
    };
    for (const headword of fileToWords.get(page.title) ?? []) {
      const entry = cache.words[headword] ?? { files: [], audio: [] };
      entry.audio = [...entry.audio.filter((candidate) => candidate.fileTitle !== page.title), item];
      cache.words[headword] = entry;
    }
  }
  if ((batchIndex + 1) % 10 === 0 || batchIndex === chunks(unresolvedFiles, batchSize).length - 1) {
    process.stdout.write(`Commons files: ${Math.min((batchIndex + 1) * batchSize, unresolvedFiles.length)}/${unresolvedFiles.length}\n`);
  }
  await sleep(140);
}

for (const entry of Object.values(cache.words)) {
  entry.audio = (entry.audio ?? [])
    .filter((item) => {
      const languageMetadata = item.languageCode ? { LanguageCode: item.languageCode } : {};
      return allowedCommonsLicense(item.license)
        && englishAudioEvidence(item.fileTitle, languageMetadata).accepted
        && Boolean(item.creator && item.licenseUrl && item.dialect);
    })
    .sort((a, b) => audioScore(b.fileTitle, b.license) - audioScore(a.fileTitle, a.license))
    .slice(0, 2);
}
cache.generatedAt = new Date().toISOString();
await fs.mkdir(path.dirname(cachePath), { recursive: true });
await fs.writeFile(cachePath, JSON.stringify(cache));
const coverage = allHeadwords.filter((headword) => cache.words[headword]?.audio?.length).length;
console.log(JSON.stringify({ output: cachePath, queried: pending.length, words: allHeadwords.length, humanAudioCoverage: coverage }));
