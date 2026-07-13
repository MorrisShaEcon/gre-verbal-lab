const ENGLISH_NAMES = /(?:^|[^a-z])(?:english|eng|en(?:[-_](?:us|gb|uk|au|ca|nz|ie|za))?)(?:$|[^a-z])/i;

function plainText(value) {
  return String(value?.value ?? value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function allowedCommonsLicense(value) {
  const license = plainText(value);
  if (!license || /(?:^|[-\s])(?:NC|ND)(?:$|[-\s])/i.test(license)) return false;
  return /^(?:CC0(?:\s+1\.0)?|Public domain|CC BY(?:-SA)?(?:\s+\d\.\d)?(?:\s+(?:[a-z]{2,3}|international|unported))?)$/i.test(license);
}

function structuredLanguage(metadata = {}) {
  const fields = ["LanguageCode", "LanguageShortName", "Language"];
  for (const field of fields) {
    const value = plainText(metadata[field]);
    if (!value) continue;
    return {
      present: true,
      english: ENGLISH_NAMES.test(value),
      evidence: `${field}: ${value}`,
    };
  }
  return { present: false, english: false, evidence: "" };
}

export function englishAudioEvidence(title, metadata = {}) {
  const structured = structuredLanguage(metadata);
  if (structured.present) {
    return {
      accepted: structured.english,
      languageCode: structured.english ? "en" : "",
      evidence: structured.evidence,
    };
  }

  const fileTitle = String(title ?? "").replace(/^File:/i, "");
  const linguaLibre = fileTitle.match(/^LL-Q\d+(?:\s*\(([^)]+)\))?-/i);
  if (linguaLibre) {
    const code = String(linguaLibre[1] ?? "").trim().toLowerCase();
    const accepted = code === "eng" || code === "en";
    return {
      accepted,
      languageCode: accepted ? "en" : "",
      evidence: code ? `Lingua Libre filename language: ${code}` : "Lingua Libre filename has no language code",
    };
  }

  const prefix = fileTitle.match(/^en(?:[-_](us|gb|uk|au|ca|nz|ie|za))?[-_]/i);
  if (prefix) {
    return {
      accepted: true,
      languageCode: "en",
      evidence: `filename language prefix: ${prefix[0].replace(/[-_]$/, "")}`,
    };
  }

  return { accepted: false, languageCode: "", evidence: "no explicit English language evidence" };
}

export function dialectFromEnglishEvidence(title, metadata = {}) {
  const combined = `${title ?? ""} ${plainText(metadata.LanguageCode)} ${plainText(metadata.LanguageShortName)} ${plainText(metadata.Language)}`;
  if (/\ben[-_ ]?(?:us)\b|american english/i.test(combined)) return "US";
  if (/\ben[-_ ]?(?:gb|uk)\b|british english/i.test(combined)) return "UK";
  return "English";
}
