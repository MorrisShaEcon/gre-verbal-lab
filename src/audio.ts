import type { PronunciationAudio, WordEntry } from "./types";

export interface AudioPlaybackResult {
  human: boolean;
  played: boolean;
  label: string;
  source?: PronunciationAudio;
}

let activeAudio: HTMLAudioElement | null = null;
const runtimeCachePrefix = "gre-verbal-lab-commons-audio-v2:";
const positiveCacheTtlMs = 30 * 24 * 60 * 60 * 1_000;
const emptyCacheTtlMs = 24 * 60 * 60 * 1_000;
const failureCacheTtlMs = 10 * 60 * 1_000;

type EnglishAudioSource = PronunciationAudio & {
  languageCode?: string;
  languageEvidence?: string;
};

interface RuntimeAudioCacheRecord {
  sources: PronunciationAudio[];
  expiresAt: number;
  status: "ready" | "empty" | "unavailable";
}

function allowedLicense(license: string): boolean {
  const normalized = plainText(license);
  if (!normalized || /(?:^|[-\s])(?:NC|ND)(?:$|[-\s])/i.test(normalized)) return false;
  return /^(?:CC0(?:\s+1\.0)?|Public domain|CC BY(?:-SA)?(?:\s+\d\.\d)?(?:\s+(?:[a-z]{2,3}|international|unported))?)$/i.test(normalized);
}

function englishLanguageEvidence(title: string, metadata: Record<string, unknown> = {}): { accepted: boolean; evidence: string } {
  for (const field of ["LanguageCode", "LanguageShortName", "Language"] as const) {
    const value = plainText(metadata[field]);
    if (!value) continue;
    return {
      accepted: /(?:^|[^a-z])(?:english|eng|en(?:[-_](?:us|gb|uk|au|ca|nz|ie|za))?)(?:$|[^a-z])/i.test(value),
      evidence: `${field}: ${value}`,
    };
  }
  const fileTitle = String(title ?? "").replace(/^File:/i, "");
  const linguaLibre = fileTitle.match(/^LL-Q\d+(?:\s*\(([^)]+)\))?-/i);
  if (linguaLibre) {
    const code = String(linguaLibre[1] ?? "").trim().toLowerCase();
    return { accepted: code === "eng" || code === "en", evidence: `Lingua Libre filename language: ${code || "missing"}` };
  }
  const prefix = fileTitle.match(/^en(?:[-_](?:us|gb|uk|au|ca|nz|ie|za))?[-_]/i);
  return prefix
    ? { accepted: true, evidence: `filename language prefix: ${prefix[0].replace(/[-_]$/, "")}` }
    : { accepted: false, evidence: "no explicit English language evidence" };
}

function isLicensedEnglishHumanSource(source: PronunciationAudio): boolean {
  const extended = source as EnglishAudioSource;
  const metadata = extended.languageCode ? { LanguageCode: extended.languageCode } : {};
  return source.human
    && /^https:\/\/upload\.wikimedia\.org\//i.test(source.url)
    && /^https:\/\/commons\.wikimedia\.org\//i.test(source.sourcePageUrl)
    && allowedLicense(source.license)
    && Boolean(source.licenseUrl && source.creator && source.dialect)
    && englishLanguageEvidence(source.fileTitle, metadata).accepted;
}

function stopActiveAudio() {
  if (!activeAudio) return;
  activeAudio.pause();
  activeAudio.removeAttribute("src");
  activeAudio.load();
  activeAudio = null;
}

function playableHumanSources(word: WordEntry): PronunciationAudio[] {
  return (word.audioSources ?? []).filter(isLicensedEnglishHumanSource);
}

function plainText(value: unknown): string {
  const unwrapped = value && typeof value === "object" && "value" in value
    ? (value as { value?: unknown }).value
    : value;
  return String(unwrapped ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function exactAudioTitle(title: string, headword: string): boolean {
  const basename = title.replace(/^File:/i, "").replace(/\.(?:wav|ogg|oga|mp3|flac)$/i, "").toLowerCase().replace(/[ _]+/g, "-");
  const target = headword.toLowerCase().replace(/[ _]+/g, "-");
  return basename === target || basename.endsWith(`-${target}`);
}

function runtimeAudioScore(source: PronunciationAudio): number {
  let score = 0;
  if (/\ben-us\b/i.test(source.fileTitle)) score += 60;
  if (/Lingua Libre/i.test(source.sourceLabel)) score += 45;
  if (/CC0/i.test(source.license)) score += 25;
  else if (/CC BY /i.test(source.license)) score += 16;
  else if (/CC BY-SA/i.test(source.license)) score += 10;
  return score;
}

function fallbackLicenseUrl(license: string): string {
  if (/CC0/i.test(license)) return "https://creativecommons.org/publicdomain/zero/1.0/";
  if (/Public domain/i.test(license)) return "https://creativecommons.org/publicdomain/mark/1.0/";
  const version = license.match(/(\d\.\d)/)?.[1] ?? "4.0";
  if (/CC BY-SA/i.test(license)) return `https://creativecommons.org/licenses/by-sa/${version}/`;
  if (/CC BY/i.test(license)) return `https://creativecommons.org/licenses/by/${version}/`;
  return "";
}

function readRuntimeAudio(headword: string): PronunciationAudio[] | null {
  try {
    const raw = localStorage.getItem(`${runtimeCachePrefix}${headword}`);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<RuntimeAudioCacheRecord>;
    if (!Number.isFinite(parsed.expiresAt) || Number(parsed.expiresAt) <= Date.now()) return null;
    return (parsed.sources ?? []).filter(isLicensedEnglishHumanSource);
  } catch {
    return null;
  }
}

function writeRuntimeAudio(headword: string, sources: PronunciationAudio[], status: RuntimeAudioCacheRecord["status"], ttlMs: number) {
  const record: RuntimeAudioCacheRecord = { sources, status, expiresAt: Date.now() + ttlMs };
  try {
    localStorage.setItem(`${runtimeCachePrefix}${headword}`, JSON.stringify(record));
  } catch {
    // Storage can be disabled; playback still works for this click.
  }
}

async function commonsRequest(params: Record<string, string>): Promise<any> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("origin", "*");
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 3_500);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Commons API ${response.status}`);
    return await response.json();
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function findRuntimeAudio(headword: string): Promise<PronunciationAudio[]> {
  const cached = readRuntimeAudio(headword);
  if (cached !== null) return cached;
  try {
    const search = await commonsRequest({
      action: "query",
      list: "search",
      srnamespace: "6",
      srsearch: `filetype:audio intitle:${headword}`,
      srprop: "",
      srlimit: "20",
    });
    const titles = (search.query?.search ?? [])
      .map((result: { title?: string }) => result.title ?? "")
      .filter((title: string) => exactAudioTitle(title, headword))
      .slice(0, 8);
    if (!titles.length) {
      writeRuntimeAudio(headword, [], "empty", emptyCacheTtlMs);
      return [];
    }
    const metadata = await commonsRequest({
      action: "query",
      prop: "imageinfo",
      iiprop: "url|mime|extmetadata",
      titles: titles.join("|"),
    });
    const sources = (metadata.query?.pages ?? []).flatMap((page: any) => {
      const info = page.imageinfo?.[0];
      const ext = info?.extmetadata ?? {};
      const license = plainText(ext.LicenseShortName?.value);
      const language = englishLanguageEvidence(String(page.title ?? ""), ext);
      const creator = plainText(ext.Artist?.value);
      const licenseUrl = plainText(ext.LicenseUrl?.value) || fallbackLicenseUrl(license);
      if (!/^https:\/\/upload\.wikimedia\.org\//i.test(info?.url ?? "")
        || !/^https:\/\/commons\.wikimedia\.org\//i.test(info?.descriptionurl ?? "")
        || !allowedLicense(license) || !language.accepted || !creator || !licenseUrl) return [];
      const fileTitle = String(page.title ?? "");
      const languageMetadata = `${plainText(ext.LanguageCode?.value)} ${plainText(ext.LanguageShortName?.value)} ${plainText(ext.Language?.value)}`;
      const dialect = /\ben[-_ ]?us\b|american english/i.test(`${fileTitle} ${languageMetadata}`)
        ? "US"
        : /\ben[-_ ]?(?:gb|uk)\b|british english/i.test(`${fileTitle} ${languageMetadata}`) ? "UK" : "English";
      return [{
        id: `commons-${page.pageid}`,
        fileTitle,
        url: info.url,
        sourcePageUrl: info.descriptionurl,
        sourceLabel: /Lingua Libre/i.test(plainText(ext.ImageDescription?.value) + fileTitle) ? "Lingua Libre / Wikimedia Commons" : "Wikimedia Commons",
        creator,
        license,
        licenseUrl,
        dialect,
        languageCode: "en",
        languageEvidence: language.evidence,
        human: true,
        mimeType: info.mime,
      } as EnglishAudioSource];
    }).sort((left: PronunciationAudio, right: PronunciationAudio) => runtimeAudioScore(right) - runtimeAudioScore(left)).slice(0, 2);
    writeRuntimeAudio(headword, sources, sources.length ? "ready" : "empty", sources.length ? positiveCacheTtlMs : emptyCacheTtlMs);
    return sources;
  } catch {
    writeRuntimeAudio(headword, [], "unavailable", failureCacheTtlMs);
    return [];
  }
}

async function playHumanSource(source: PronunciationAudio, playbackRate: number): Promise<void> {
  stopActiveAudio();
  const audio = new Audio();
  activeAudio = audio;
  audio.preload = "auto";
  audio.playbackRate = playbackRate;
  audio.src = source.url;
  await audio.play();
}

function friendlyHumanPlaybackError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError") {
    return "浏览器阻止了自动播放。请先点击页面，再点一次发音按钮。";
  }
  if (name === "AbortError") {
    return "播放被浏览器中断，请稍后再试。";
  }
  if (name === "NotSupportedError") {
    return "当前浏览器暂不支持这条录音的格式，请换一个浏览器重试。";
  }
  if (error instanceof TypeError || /network|fetch|media|decode/i.test(error instanceof Error ? error.message : String(error))) {
    return "真人录音暂时无法加载，请检查网络后重试。";
  }
  return "真人录音暂时无法播放，请稍后再试。";
}

function playSpeechSynthesis(headword: string, playbackRate: number): Promise<void> {
  if (!("speechSynthesis" in window)) return Promise.reject(new Error("当前浏览器不支持备用合成语音。"));
  stopActiveAudio();
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(headword);
  utterance.lang = "en-US";
  utterance.rate = Math.max(0.65, Math.min(1.1, playbackRate * 0.9));
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find((voice) => voice.lang.toLowerCase() === "en-us" && /samantha|ava|allison|google us english/i.test(voice.name))
    ?? voices.find((voice) => voice.lang.toLowerCase() === "en-us")
    ?? null;
  return new Promise((resolve, reject) => {
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error("备用合成语音播放失败。"));
    window.speechSynthesis.speak(utterance);
  });
}

export function preferredAudioSource(word: WordEntry): PronunciationAudio | null {
  return playableHumanSources(word)[0] ?? null;
}

export async function playPronunciation(word: WordEntry, playbackRate = 1): Promise<AudioPlaybackResult> {
  const embedded = playableHumanSources(word);
  const runtimeCached = readRuntimeAudio(word.normalizedHeadword);
  const sources = [...embedded, ...(runtimeCached ?? [])];
  let lastHumanError = "";
  for (const source of sources) {
    try {
      await playHumanSource(source, playbackRate);
      return { human: true, played: true, label: `真人录音 · ${source.dialect}`, source };
    } catch (error) {
      lastHumanError = friendlyHumanPlaybackError(error);
      // Try the next licensed human recording before using synthesized speech.
    }
  }
  if (sources.length) return { human: true, played: false, label: `真人录音已就绪，但未能播放：${lastHumanError}`, source: sources[0] };
  if (runtimeCached === null && !embedded.length) {
    const discovered = await findRuntimeAudio(word.normalizedHeadword);
    if (discovered.length) return { human: true, played: false, label: "已找到开放许可真人录音，请再点击一次播放。", source: discovered[0] };
    await playSpeechSynthesis(word.headword, playbackRate);
    return { human: false, played: true, label: "未找到可用的英语真人录音，已播放系统合成备用音" };
  }
  await playSpeechSynthesis(word.headword, playbackRate);
  return { human: false, played: true, label: "系统合成备用音" };
}

export function stopPronunciation() {
  stopActiveAudio();
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
