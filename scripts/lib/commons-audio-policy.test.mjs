import { describe, expect, it } from "vitest";
import { allowedCommonsLicense, dialectFromEnglishEvidence, englishAudioEvidence } from "./commons-audio-policy.mjs";

describe("Commons pronunciation policy", () => {
  it("accepts only explicit English filenames when structured language metadata is absent", () => {
    expect(englishAudioEvidence("File:LL-Q1860 (eng)-Vealhurl-aberrant.wav").accepted).toBe(true);
    expect(englishAudioEvidence("File:En-us-abate.oga").accepted).toBe(true);
    expect(englishAudioEvidence("File:En-gb-abate.oga").accepted).toBe(true);
    expect(englishAudioEvidence("File:En-abate.oga").accepted).toBe(true);

    // These exact filename families occurred in the previous public-source cache.
    expect(englishAudioEvidence("File:LL-Q150 (fra)-Poslovitch-abandon.wav").accepted).toBe(false);
    expect(englishAudioEvidence("File:LL-Q809 (pol)-Poemat-chimera.wav").accepted).toBe(false);
    expect(englishAudioEvidence("File:LL-Q7411 (nld)-speaker-word.wav").accepted).toBe(false);
    expect(englishAudioEvidence("File:De-abstruse.ogg").accepted).toBe(false);
    expect(englishAudioEvidence("File:word.ogg").accepted).toBe(false);
  });

  it("gives structured language metadata priority over a filename", () => {
    expect(englishAudioEvidence("File:En-word.ogg", { LanguageCode: { value: "fra" } }).accepted).toBe(false);
    expect(englishAudioEvidence("File:word.ogg", { LanguageCode: { value: "en-US" } }).accepted).toBe(true);
    expect(dialectFromEnglishEvidence("File:word.ogg", { LanguageCode: { value: "en-GB" } })).toBe("UK");
  });

  it("allows attribution-friendly licenses but rejects NC and ND variants", () => {
    for (const license of ["CC0", "CC0 1.0", "Public domain", "CC BY 4.0", "CC BY-SA 4.0", "CC BY 2.0 fr"]) {
      expect(allowedCommonsLicense(license), license).toBe(true);
    }
    for (const license of ["CC BY-NC 4.0", "CC BY-ND 4.0", "CC BY-NC-SA 4.0", "CC BY-SA-ND 4.0", "GFDL", "CC BY-SA 4.0 custom"]) {
      expect(allowedCommonsLicense(license), license).toBe(false);
    }
  });
});
