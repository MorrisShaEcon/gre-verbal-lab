function normalizedTokens(value) {
  return String(value ?? "").toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
}

function tokenMatchesHeadword(token, headword) {
  if (token === headword) return true;
  const suffixes = ["s", "es", "ed", "ing", "ly", "er", "est", "ness", "ment", "tion", "al"];
  if (token.startsWith(headword) && suffixes.includes(token.slice(headword.length))) return true;
  if (headword.endsWith("e") && token.startsWith(headword.slice(0, -1)) && ["ing", "ed"].includes(token.slice(headword.length - 1))) return true;
  if (headword.endsWith("y") && token.startsWith(headword.slice(0, -1)) && ["ies", "ied"].includes(token.slice(headword.length - 1))) return true;
  const final = headword.at(-1);
  if (final && token.startsWith(`${headword}${final}`) && ["ed", "ing"].includes(token.slice(headword.length + 1))) return true;
  return false;
}

export function textContainsHeadword(text, headword) {
  const normalized = String(headword ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (/[^a-z]/.test(normalized)) return String(text ?? "").toLowerCase().includes(normalized);
  return normalizedTokens(text).some((token) => tokenMatchesHeadword(token, normalized));
}

export function selectDictionaryExampleTexts(examples, headword, limit = 2) {
  const texts = examples.map((value) => String(value ?? "").trim()).filter(Boolean);
  const targetBearing = texts.filter((text) => textContainsHeadword(text, headword));
  const sameSynsetFallbacks = texts.filter((text) => !textContainsHeadword(text, headword));
  return [...targetBearing, ...sameSynsetFallbacks].slice(0, limit);
}
