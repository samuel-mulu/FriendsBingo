import { DepositApprovalMode, PaymentProvider } from '@prisma/client';

const REFERENCE_PATTERN = /^[A-Za-z0-9-]{6,120}$/;

export interface CanonicalizeDepositReferenceInput {
  provider: PaymentProvider;
  approvalMode: DepositApprovalMode;
  transactionRef: string;
  cbeReceiptBaseUrl: string;
}

export function canonicalizeDepositTransactionRef(
  input: CanonicalizeDepositReferenceInput,
): string | null {
  const trimmed = input.transactionRef.trim();
  if (!trimmed) {
    return null;
  }

  if (
    input.provider === PaymentProvider.CBE &&
    input.approvalMode === DepositApprovalMode.MANUAL
  ) {
    const reference = isUrlInput(trimmed)
      ? extractCbeReferenceFromOfficialUrl(trimmed, input.cbeReceiptBaseUrl)
      : trimmed;
    if (!reference || !REFERENCE_PATTERN.test(reference)) {
      return null;
    }

    return reference.toUpperCase().startsWith('FT')
      ? reference.toUpperCase()
      : reference;
  }

  // Existing behavior for every non-CBE-manual path.
  const normalized = trimmed.toUpperCase();
  return REFERENCE_PATTERN.test(normalized) ? normalized : null;
}

function isUrlInput(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function extractCbeReferenceFromOfficialUrl(
  value: string,
  receiptBaseUrl: string,
): string | null {
  try {
    const url = new URL(value);
    const baseUrl = new URL(receiptBaseUrl);
    if (url.origin.toLowerCase() !== baseUrl.origin.toLowerCase()) {
      return null;
    }

    for (const key of ['id', 'token', 'reference', 'ref']) {
      const queryValue = url.searchParams.get(key)?.trim();
      if (queryValue) {
        return queryValue;
      }
    }

    const baseSegments = pathSegments(baseUrl);
    const candidateSegments = pathSegments(url);
    if (!startsWithSegments(candidateSegments, baseSegments)) {
      return null;
    }

    return candidateSegments.length > baseSegments.length
      ? candidateSegments[baseSegments.length].trim()
      : null;
  } catch {
    return null;
  }
}

function pathSegments(url: URL): string[] {
  return url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

function startsWithSegments(value: string[], prefix: string[]): boolean {
  return prefix.every(
    (segment, index) => value[index]?.toLowerCase() === segment.toLowerCase(),
  );
}
