import { afterEach, describe, expect, it, vi } from "vitest";
import { playPronunciation, preferredAudioSource, stopPronunciation } from "./audio";
import { stableId, type WordEntry } from "./types";

function audioWord(): WordEntry {
  return {
    id: stableId("word", "laconic"),
    headword: "laconic",
    normalizedHeadword: "laconic",
    pronunciations: [],
    audioSources: [{
      id: "commons-1",
      fileTitle: "LL-Q1860 (eng)-speaker-laconic.wav",
      url: "https://upload.wikimedia.org/wikipedia/commons/test/laconic.wav",
      sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Laconic.wav",
      sourceLabel: "Lingua Libre / Wikimedia Commons",
      creator: "Test speaker",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      dialect: "US",
      human: true,
      mimeType: "audio/wav",
    }],
    senses: [],
    sourceFiles: ["test"],
    initialLapses: 0,
    sourceConsensus: false,
    frequencyProfile: {
      tier: "focus",
      rank: 1,
      priorityScore: 100,
      localMaterialCount: 0,
      officialMaterialCount: 0,
      evidenceBySource: {},
    },
    order: 0,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
}

afterEach(() => {
  stopPronunciation();
  vi.unstubAllGlobals();
});

describe("pronunciation playback", () => {
  it("rejects known non-English Commons filename families before playback", () => {
    for (const fileTitle of [
      "File:LL-Q150 (fra)-Poslovitch-laconic.wav",
      "File:LL-Q809 (pol)-Poemat-laconic.wav",
      "File:LL-Q7411 (nld)-speaker-laconic.wav",
      "File:De-laconic.ogg",
      "File:laconic.ogg",
    ]) {
      const word = audioWord();
      word.audioSources[0].fileTitle = fileTitle;
      expect(preferredAudioSource(word), fileTitle).toBeNull();
    }
  });

  it("turns browser autoplay rejection into a useful, non-technical prompt", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.stubGlobal("window", {});
    vi.stubGlobal("Audio", class {
      preload = "";
      playbackRate = 1;
      src = "";
      pause() {}
      removeAttribute() {}
      load() {}
      play() {
        const error = new Error("play() failed because the user did not interact with the document");
        Object.defineProperty(error, "name", { value: "NotAllowedError" });
        return Promise.reject(error);
      }
    });

    const result = await playPronunciation(audioWord());

    expect(result).toMatchObject({ human: true, played: false });
    expect(result.label).toContain("请先点击页面，再点一次发音按钮");
    expect(result.label).not.toContain("NotAllowedError");
    expect(result.label).not.toContain("play() failed");
  });

  it("falls back during the same click and caches a network failure with a TTL", async () => {
    const storage = new Map<string, string>();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network unavailable"));
    const speechSynthesis = {
      cancel: vi.fn(),
      getVoices: () => [],
      speak: (utterance: { onend?: () => void }) => utterance.onend?.(),
    };
    class Utterance {
      lang = "";
      rate = 1;
      voice = null;
      onend?: () => void;
      onerror?: () => void;
      constructor(public text: string) {}
    }
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { speechSynthesis });
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
    const word = audioWord();
    word.audioSources = [];

    const first = await playPronunciation(word);
    const second = await playPronunciation(word);

    expect(first).toMatchObject({ human: false, played: true });
    expect(first.label).toContain("已播放系统合成备用音");
    expect(second).toMatchObject({ human: false, played: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect([...storage.values()][0]).toContain('"status":"unavailable"');
    expect([...storage.values()][0]).toContain('"expiresAt"');
  });

  it("accepts explicit English structured metadata when a runtime filename has no language prefix", async () => {
    const storage = new Map<string, string>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ query: { search: [{ title: "File:laconic.ogg" }] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: [{
              pageid: 42,
              title: "File:laconic.ogg",
              imageinfo: [{
                url: "https://upload.wikimedia.org/wikipedia/commons/test/laconic.ogg",
                descriptionurl: "https://commons.wikimedia.org/wiki/File:Laconic.ogg",
                mime: "audio/ogg",
                extmetadata: {
                  LanguageCode: { value: "en-GB" },
                  LicenseShortName: { value: "CC BY-SA 4.0" },
                  LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
                  Artist: { value: "Test speaker" },
                },
              }],
            }],
          },
        }),
      });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {});
    const word = audioWord();
    word.audioSources = [];

    const result = await playPronunciation(word);

    expect(result).toMatchObject({ human: true, played: false });
    expect(result.source).toMatchObject({ fileTitle: "File:laconic.ogg", dialect: "UK" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
