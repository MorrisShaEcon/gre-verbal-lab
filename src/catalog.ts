import type { VocabularyCatalog } from "./types";

declare global {
  interface Window {
    __GRE_CATALOG__?: VocabularyCatalog;
  }
}

function validCatalog(value: unknown): value is VocabularyCatalog {
  const catalog = value as Partial<VocabularyCatalog> | null;
  return Boolean(catalog && catalog.schemaVersion === 2 && catalog.catalogVersion && Array.isArray(catalog.words) && catalog.words.length);
}

async function fetchCatalog(path: string): Promise<VocabularyCatalog | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${path}`, { cache: "no-store" });
    if (!response.ok) return null;
    const catalog = (await response.json()) as unknown;
    return validCatalog(catalog) ? catalog : null;
  } catch {
    return null;
  }
}

export type CatalogBuildMode = "open" | "personal" | "development";

export function catalogPathsForBuildMode(mode: CatalogBuildMode): string[] {
  if (mode === "open") return ["data/catalog.open.json"];
  if (mode === "personal") return ["data/catalog.personal.json"];
  return ["data/catalog.personal.json", "data/catalog.open.json"];
}

export async function loadVocabularyCatalog(): Promise<VocabularyCatalog> {
  if (validCatalog(window.__GRE_CATALOG__)) return window.__GRE_CATALOG__;
  const buildMode = (import.meta.env.VITE_CATALOG_BUILD_MODE ?? "development") as CatalogBuildMode;
  for (const path of catalogPathsForBuildMode(buildMode)) {
    const catalog = await fetchCatalog(path);
    if (catalog) return catalog;
  }
  throw new Error("默认词汇数据库没有随应用加载。请重新生成个人版本或恢复公开示例数据库。");
}
