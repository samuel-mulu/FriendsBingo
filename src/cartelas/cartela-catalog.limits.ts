/** Max rows returned for paged/shuffled GET /cartelas (aligned with mobile catalog fetch). */
export const CARTELA_CATALOG_MAX_LIMIT = 500;

/** Default when shuffle/paging omits `limit` (must be <= max). */
export const CARTELA_CATALOG_DEFAULT_LIMIT = 500;

export function clampCartelaCatalogLimit(
  requested: number | undefined | null,
): number {
  const fallback = CARTELA_CATALOG_DEFAULT_LIMIT;
  const raw = requested ?? fallback;
  if (!Number.isFinite(raw) || raw < 1) {
    return fallback;
  }
  return Math.min(Math.trunc(raw), CARTELA_CATALOG_MAX_LIMIT);
}
