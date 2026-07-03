import {
  DEFAULT_EXCLUDED_CARTELA_RANGES,
  filterCartelaSeedEntries,
  isCartelaNumberExcluded,
  parseExcludedCartelaRanges,
} from './cartela-seed-filter';

describe('cartela-seed-filter', () => {
  it('excludes cartela numbers 2000-3000 by default', () => {
    expect(isCartelaNumberExcluded(1999, DEFAULT_EXCLUDED_CARTELA_RANGES)).toBe(
      false,
    );
    expect(isCartelaNumberExcluded(2000, DEFAULT_EXCLUDED_CARTELA_RANGES)).toBe(
      true,
    );
    expect(isCartelaNumberExcluded(3000, DEFAULT_EXCLUDED_CARTELA_RANGES)).toBe(
      true,
    );
    expect(isCartelaNumberExcluded(3001, DEFAULT_EXCLUDED_CARTELA_RANGES)).toBe(
      false,
    );
  });

  it('keeps 8999 cartelas when filtering a full 1-10000 pool', () => {
    const entries = Array.from({ length: 10_000 }, (_, index) => ({
      number: index + 1,
    }));

    const filtered = filterCartelaSeedEntries(entries);
    expect(filtered).toHaveLength(8999);
    expect(filtered[0]?.number).toBe(1);
    expect(filtered.at(-1)?.number).toBe(10_000);
    expect(filtered.some((entry) => entry.number === 2500)).toBe(false);
  });

  it('allows disabling exclusions with SEED_CARTELA_EXCLUDE_RANGES=none', () => {
    const entries = [{ number: 2500 }];
    expect(
      filterCartelaSeedEntries(entries, parseExcludedCartelaRanges('none')),
    ).toHaveLength(1);
  });
});
