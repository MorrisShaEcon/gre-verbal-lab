import { execFileSync } from "node:child_process";

const HAN = /\p{Script=Han}/u;
const XML_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

function decodeXml(value) {
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, entity) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return XML_ENTITIES.get(entity.toLowerCase()) ?? `&${entity};`;
  });
}

function attribute(attributes, name) {
  return decodeXml(attributes.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "");
}

export function normalizeChinese(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replaceAll("+", "")
    .replace(/[^\p{Script=Han}]/gu, "");
}

function hanLength(value) {
  return [...value].filter((character) => HAN.test(character)).length;
}

function bigrams(value) {
  const characters = [...value];
  if (characters.length < 2) return new Set(characters);
  return new Set(characters.slice(0, -1).map((character, index) => `${character}${characters[index + 1]}`));
}

function dice(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function longestCommonSubstringLength(left, right) {
  if (!left || !right) return 0;
  const a = [...left];
  const b = [...right];
  let previous = new Uint16Array(b.length + 1);
  let longest = 0;
  for (let row = 1; row <= a.length; row += 1) {
    const current = new Uint16Array(b.length + 1);
    for (let column = 1; column <= b.length; column += 1) {
      if (a[row - 1] === b[column - 1]) {
        current[column] = previous[column - 1] + 1;
        longest = Math.max(longest, current[column]);
      }
    }
    previous = current;
  }
  return longest;
}

function negativeImmediatelyBefore(gloss, lemma) {
  const index = gloss.indexOf(lemma);
  if (index < 0 || index === 0) return false;
  return /[不无非未莫勿]/u.test([...gloss][index - 1] ?? "");
}

export function scoreChineseLemma(definitionZh, rawLemma) {
  const gloss = normalizeChinese(definitionZh);
  const lemma = normalizeChinese(rawLemma);
  const lemmaLength = hanLength(lemma);
  if (!gloss || !lemma) return { score: 0, matchType: "none", direct: false };

  if (gloss === lemma) return { score: 1, matchType: "exact", direct: true };
  if (lemmaLength >= 2 && gloss.includes(lemma)) {
    if (negativeImmediatelyBefore(gloss, lemma) && !/^[不无非未莫勿]/u.test(lemma)) {
      return { score: 0.24, matchType: "polarity-conflict", direct: false };
    }
    const coverage = lemmaLength / Math.max(lemmaLength, hanLength(gloss));
    return { score: Math.min(0.97, 0.82 + coverage * 0.15), matchType: "lemma-in-gloss", direct: true };
  }
  if (hanLength(gloss) >= 2 && lemma.includes(gloss)) {
    const coverage = hanLength(gloss) / Math.max(lemmaLength, hanLength(gloss));
    return { score: Math.min(0.94, 0.78 + coverage * 0.15), matchType: "gloss-in-lemma", direct: true };
  }
  if (lemmaLength === 1 && gloss === lemma) return { score: 0.9, matchType: "single-character-exact", direct: true };

  const commonLength = longestCommonSubstringLength(gloss, lemma);
  const commonRatio = commonLength / Math.max(1, Math.min(hanLength(gloss), lemmaLength));
  const similarity = dice(gloss, lemma) * 0.62 + commonRatio * 0.38;
  return {
    score: Math.min(0.76, similarity * 0.76),
    matchType: commonLength >= 2 ? "partial-overlap" : "none",
    direct: false,
  };
}

export function parseChineseOpenWordnetXml(xml) {
  const lemmasBySynset = new Map();
  for (const block of xml.matchAll(/<LexicalEntry\b[\s\S]*?<\/LexicalEntry>/g)) {
    const lemmaAttributes = block[0].match(/<Lemma\b([^>]*)\/>/)?.[1] ?? "";
    const lemma = attribute(lemmaAttributes, "writtenForm");
    if (!lemma) continue;
    for (const sense of block[0].matchAll(/<Sense\b([^>]*)\/>/g)) {
      const synsetId = attribute(sense[1], "synset");
      if (!synsetId) continue;
      const lemmas = lemmasBySynset.get(synsetId) ?? [];
      if (!lemmas.includes(lemma)) lemmas.push(lemma);
      lemmasBySynset.set(synsetId, lemmas);
    }
  }

  const lemmasByIli = new Map();
  for (const match of xml.matchAll(/<Synset\b([^>]*?)(?:\/>|>)/g)) {
    const synsetId = attribute(match[1], "id");
    const ili = attribute(match[1], "ili");
    if (!synsetId || !ili || ili === "in") continue;
    const lemmas = lemmasBySynset.get(synsetId) ?? [];
    if (!lemmas.length) continue;
    const existing = lemmasByIli.get(ili) ?? [];
    lemmasByIli.set(ili, [...new Set([...existing, ...lemmas])]);
  }
  return lemmasByIli;
}

export function loadChineseOpenWordnet(archivePath) {
  const xml = execFileSync(
    "tar",
    ["-xOJf", archivePath, "omw-cmn/omw-cmn.xml"],
    { encoding: "utf8", maxBuffer: 48 * 1024 * 1024 },
  );
  return parseChineseOpenWordnetXml(xml);
}

export function alignChineseSense(definitionZh, candidates, synsets, chineseByIli) {
  const ranked = candidates.map((reference) => {
    const synset = synsets.get(reference.synset);
    const ili = synset?.ili ?? "";
    const lemmas = chineseByIli.get(ili) ?? [];
    let best = { score: 0, matchType: "none", direct: false, lemma: "" };
    for (const lemma of lemmas) {
      const result = scoreChineseLemma(definitionZh, lemma);
      if (result.score > best.score) best = { ...result, lemma };
    }
    return { reference, synset, ili, lemmas, ...best };
  }).sort((left, right) => right.score - left.score || left.reference.synset.localeCompare(right.reference.synset));

  const best = ranked[0];
  const runnerUp = ranked[1];
  const margin = best ? best.score - (runnerUp?.score ?? 0) : 0;
  const lemmaLength = hanLength(normalizeChinese(best?.lemma ?? ""));
  const uniqueDirectIli = best?.direct && ranked.filter((item) => item.direct && item.ili !== best.ili).length === 0;
  const reliableDirectMatch = Boolean(
    best?.direct
    && best.score >= 0.86
    && lemmaLength >= 2
    && (lemmaLength >= 3 || best.matchType === "exact" || normalizeChinese(definitionZh).length <= 5)
    && uniqueDirectIli
    && margin >= 0.08,
  );

  return {
    state: reliableDirectMatch ? "verified" : best?.score > 0 ? "candidate" : "missing",
    score: Number((best?.score ?? 0).toFixed(4)),
    margin: Number(margin.toFixed(4)),
    matchedLemma: best?.lemma ?? "",
    matchType: best?.matchType ?? "none",
    ili: best?.ili ?? "",
    reference: best?.reference,
    synset: best?.synset,
    alternatives: ranked.slice(0, 3).map((item) => ({
      senseKey: item.reference.id,
      synsetId: item.reference.synset,
      ili: item.ili,
      score: Number(item.score.toFixed(4)),
      matchedLemma: item.lemma,
      matchType: item.matchType,
      definitionEn: item.synset?.definition?.[0] ?? "",
    })),
  };
}
