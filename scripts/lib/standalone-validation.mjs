export function extractEmbeddedCatalog(html) {
  const match = html.match(/window\.__GRE_CATALOG__=(\{[\s\S]*?\})\s*<\/script><script type="module">/);
  if (!match) throw new Error("Embedded catalog not found");
  return JSON.parse(match[1]);
}

export function validateStandaloneHtml(html) {
  const catalog = extractEmbeddedCatalog(html);
  if (!catalog.words?.length) throw new Error("Embedded catalog is empty");
  if (/\b(?:src|href)="\/gre-verbal-lab\/assets\//.test(html)) {
    throw new Error("Standalone still references built assets");
  }
  if (catalog.visibility === "public-open-demo") {
    const serialized = JSON.stringify(catalog);
    if (/\.xlsx|private_user_held|restricted_source/i.test(serialized)) {
      throw new Error("Private source marker leaked into public standalone");
    }
  }
  return catalog;
}
