import { describe, expect, it } from "vitest";
import { extractEmbeddedCatalog, validateStandaloneHtml } from "./standalone-validation.mjs";

const moduleScript = '<script type="module">console.log("app")</script>';

describe("standalone validation", () => {
  it("accepts both minified and pretty-printed embedded catalogs", () => {
    const catalog = { visibility: "private-local-build", words: [{ id: "word-1" }] };
    const minified = `<script>window.__GRE_CATALOG__=${JSON.stringify(catalog)}</script>${moduleScript}`;
    const pretty = `<script>window.__GRE_CATALOG__=${JSON.stringify(catalog, null, 2)}\n</script>${moduleScript}`;
    expect(extractEmbeddedCatalog(minified)).toEqual(catalog);
    expect(extractEmbeddedCatalog(pretty)).toEqual(catalog);
  });

  it("rejects private source markers in a public standalone", () => {
    const catalog = { visibility: "public-open-demo", words: [{ id: "word-1", source: "private.xlsx" }] };
    const html = `<script>window.__GRE_CATALOG__=${JSON.stringify(catalog)}</script>${moduleScript}`;
    expect(() => validateStandaloneHtml(html)).toThrow(/Private source marker/);
  });
});
