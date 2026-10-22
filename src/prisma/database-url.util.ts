import type { PoolConfig } from 'pg';

/**
 * Neon pooler hostnames include "-pooler"; the direct host drops that suffix.
 */
export function deriveDirectDatabaseUrl(pooledUrl: string): string {
  const poolerHostPattern = /(-pooler)(?=\.)/;
  if (!poolerHostPattern.test(pooledUrl)) {
    return pooledUrl;
  }

  return pooledUrl.replace(poolerHostPattern, '');
}

export function resolveDirectDatabaseUrl(
  databaseUrl: string,
  directUrl?: string | null,
): string {
  const trimmed = directUrl?.trim();
  if (trimmed) {
    return trimmed;
  }

  return deriveDirectDatabaseUrl(databaseUrl);
}

export function createPgPoolConfig(
  connectionString: string,
  max: number,
  options?: {
    connectionTimeoutMillis?: number;
    idleTimeoutMillis?: number;
  },
): PoolConfig {
  return {
    connectionString,
    max,
    idleTimeoutMillis: options?.idleTimeoutMillis ?? 300_000,
    connectionTimeoutMillis: options?.connectionTimeoutMillis ?? 30_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    allowExitOnIdle: false,
  };
}
