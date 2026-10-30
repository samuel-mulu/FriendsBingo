import {
  CARTELA_CATALOG_DEFAULT_LIMIT,
  CARTELA_CATALOG_MAX_LIMIT,
  clampCartelaCatalogLimit,
} from './cartela-catalog.limits';

describe('clampCartelaCatalogLimit', () => {
  it('uses default when limit omitted', () => {
    expect(clampCartelaCatalogLimit(undefined)).toBe(
      CARTELA_CATALOG_DEFAULT_LIMIT,
    );
  });

  it('clamps above max (legacy clients may send 1000)', () => {
    expect(clampCartelaCatalogLimit(1000)).toBe(CARTELA_CATALOG_MAX_LIMIT);
  });

  it('passes through values under max', () => {
    expect(clampCartelaCatalogLimit(300)).toBe(300);
  });
});
