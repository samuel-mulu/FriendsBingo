const INVALID_FCM_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function codeFromMessage(message: string): string | undefined {
  if (message.includes('registration-token-not-registered')) {
    return 'messaging/registration-token-not-registered';
  }
  if (message.includes('invalid-registration-token')) {
    return 'messaging/invalid-registration-token';
  }
  return undefined;
}

export function getFirebaseErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as {
      code?: unknown;
      errorInfo?: { code?: unknown };
      message?: unknown;
    };

    const code = readNonEmptyString(candidate.code);
    if (code) {
      return code;
    }

    const infoCode = readNonEmptyString(candidate.errorInfo?.code);
    if (infoCode) {
      return infoCode;
    }

    const message = readNonEmptyString(candidate.message);
    if (message) {
      return codeFromMessage(message) ?? 'unknown';
    }
  }

  return 'unknown';
}

export function isInvalidTokenError(error: unknown) {
  return INVALID_FCM_TOKEN_CODES.has(getFirebaseErrorCode(error));
}

export function incrementFailureCode(
  counts: Record<string, number>,
  code: string,
) {
  counts[code] = (counts[code] ?? 0) + 1;
}

export function mergeFailureCodes(
  target: Record<string, number>,
  source: Record<string, number>,
) {
  for (const [code, count] of Object.entries(source)) {
    target[code] = (target[code] ?? 0) + count;
  }
  return target;
}

export function formatFailureCodes(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => `${code}:${count}`);
  return `{${parts.join(',')}}`;
}
