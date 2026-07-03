export interface CartelaNumberRange {
  from: number;
  to: number;
}

/** Production default: skip cartela numbers 2000–3000 (8999 of 10000 remain). */
export const DEFAULT_EXCLUDED_CARTELA_RANGES: CartelaNumberRange[] = [
  { from: 2000, to: 3000 },
];

export function parseExcludedCartelaRanges(
  raw = process.env.SEED_CARTELA_EXCLUDE_RANGES,
): CartelaNumberRange[] {
  const value = raw?.trim();
  if (!value) {
    return DEFAULT_EXCLUDED_CARTELA_RANGES;
  }

  if (value === 'none' || value === 'false') {
    return [];
  }

  return value.split(',').map((segment) => {
    const [fromRaw, toRaw] = segment.split('-').map((part) => part.trim());
    const from = Number.parseInt(fromRaw, 10);
    const to = Number.parseInt(toRaw ?? fromRaw, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      throw new Error(
        `Invalid SEED_CARTELA_EXCLUDE_RANGES segment "${segment}". Use "2000-2999" or "none".`,
      );
    }
    return { from, to };
  });
}

export function isCartelaNumberExcluded(
  cartelaNumber: number,
  excludedRanges: CartelaNumberRange[],
) {
  return excludedRanges.some(
    (range) => cartelaNumber >= range.from && cartelaNumber <= range.to,
  );
}

export function filterCartelaSeedEntries<T extends { number: number }>(
  entries: T[],
  excludedRanges = parseExcludedCartelaRanges(),
) {
  if (excludedRanges.length === 0) {
    return entries;
  }

  return entries.filter(
    (entry) => !isCartelaNumberExcluded(entry.number, excludedRanges),
  );
}
