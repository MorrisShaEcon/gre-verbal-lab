export type BuildVisibility = "open" | "personal";

export function normalizeBuildVisibility(value: string): BuildVisibility;
export function enforceBuildOutputCatalogBoundary(
  outputDirectory: string,
  visibility: string,
): Promise<unknown>;
