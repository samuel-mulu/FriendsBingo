import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { parseCorsOrigins } from './env.validation';

type CorsOriginCallback = (
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
) => void;

function escapeRegExp(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function matchesCorsPattern(origin: string, pattern: string): boolean {
  if (!pattern.includes('*')) {
    return origin === pattern;
  }

  const regex = new RegExp(
    `^${pattern.split('*').map(escapeRegExp).join('.*')}$`,
  );
  return regex.test(origin);
}

export function isOriginAllowedByCorsConfig(
  origin: string | undefined,
  corsOrigins: string,
): boolean {
  const allowedOrigins = parseCorsOrigins(corsOrigins);

  if (allowedOrigins === true) {
    return true;
  }

  if (!Array.isArray(allowedOrigins)) {
    return false;
  }

  // Native mobile apps (Flutter iOS/Android) and other non-browser clients
  // do not send Origin. CORS only applies to browsers.
  if (typeof origin !== 'string' || !origin.trim()) {
    return true;
  }

  const normalizedOrigin = origin.trim();
  return allowedOrigins.some((pattern) =>
    matchesCorsPattern(normalizedOrigin, pattern),
  );
}

export function createLazyCorsOriginChecker(
  readOrigins: () => string = readCorsOriginsFromEnv,
): CorsOriginCallback {
  return (origin, callback) => {
    callback(null, isOriginAllowedByCorsConfig(origin, readOrigins()));
  };
}

export function resolveHttpCorsOptions(corsOrigins: string): CorsOptions {
  const allowedOrigins = parseCorsOrigins(corsOrigins);

  if (allowedOrigins === true) {
    return {
      origin: true,
      credentials: true,
    };
  }

  if (
    Array.isArray(allowedOrigins) &&
    allowedOrigins.some((pattern) => pattern.includes('*'))
  ) {
    return {
      origin: createLazyCorsOriginChecker(() => corsOrigins),
      credentials: true,
    };
  }

  return {
    origin: allowedOrigins,
    credentials: true,
  };
}

export function resolveWebSocketCorsOptions(
  corsOrigins: string,
): CorsOptions['origin'] {
  const allowedOrigins = parseCorsOrigins(corsOrigins);

  if (allowedOrigins === true) {
    return true;
  }

  if (
    Array.isArray(allowedOrigins) &&
    allowedOrigins.some((pattern) => pattern.includes('*'))
  ) {
    return createLazyCorsOriginChecker(() => corsOrigins);
  }

  return Array.isArray(allowedOrigins) ? allowedOrigins : [];
}

export function readCorsOriginsFromEnv(): string {
  return process.env.CORS_ORIGINS ?? 'http://localhost:3000';
}
