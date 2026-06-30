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
): PoolConfig {
  return {
    connectionString,
    max,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    allowExitOnIdle: false,
  };
}
