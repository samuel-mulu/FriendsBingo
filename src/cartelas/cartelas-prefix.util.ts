const MAX_CARTELA_DIGITS = 10;

export function sanitizeCartelaSearchPrefix(
  search?: string | null,
): string | null {
  const trimmed = search?.trim() ?? '';
  if (!trimmed) {
    return null;
  }

  if (!/^\d+$/.test(trimmed) || trimmed.length > MAX_CARTELA_DIGITS) {
    return null;
  }

  return trimmed;
}

export function buildCartelaNumberPrefixRanges(
  prefix: string,
): Array<{ min: number; max: number }> {
  const trimmed = prefix.trim();
  if (!/^\d+$/.test(trimmed)) {
    return [];
  }

  const prefixNumber = Number(trimmed);
  if (!Number.isSafeInteger(prefixNumber)) {
    return [];
  }

  const ranges: Array<{ min: number; max: number }> = [];
  for (
    let totalDigits = trimmed.length;
    totalDigits <= MAX_CARTELA_DIGITS;
    totalDigits += 1
  ) {
    const scale = 10 ** (totalDigits - trimmed.length);
    const min = prefixNumber * scale;
    const max = min + scale - 1;
    ranges.push({ min, max });
  }

  return ranges;
}

export function encodeCartelaCursor(number: number, id: string): string {
  return Buffer.from(`${number}:${id}`, 'utf8').toString('base64url');
}

export function decodeCartelaCursor(
  cursor: string,
): { number: number; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex <= 0) {
      return null;
    }

    const number = Number(decoded.slice(0, separatorIndex));
    const id = decoded.slice(separatorIndex + 1);
    if (!Number.isInteger(number) || number < 0 || id.length === 0) {
      return null;
    }

    return { number, id };
  } catch {
    return null;
  }
}
