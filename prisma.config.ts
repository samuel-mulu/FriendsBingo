import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

function withConnectTimeout(url: string): string {
  if (url.includes('connect_timeout=')) {
    return url;
  }

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connect_timeout=30`;
}

/**
 * Prisma migrations need a session-capable (non-pooler) connection.
 * Neon pooler hostnames include "-pooler"; the direct host drops that suffix.
 */
function deriveDirectDatabaseUrl(pooledUrl: string): string {
  const poolerHostPattern = /(-pooler)(?=\.)/;
  if (!poolerHostPattern.test(pooledUrl)) {
    return pooledUrl;
  }

  return pooledUrl.replace(poolerHostPattern, '');
}

function resolveMigrationDatabaseUrl(): string {
  const directUrl = process.env.DIRECT_URL?.trim();
  if (directUrl) {
    return directUrl;
  }

  return deriveDirectDatabaseUrl(env('DATABASE_URL'));
}

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    path: './prisma/migrations',
  },
  datasource: {
    url: withConnectTimeout(resolveMigrationDatabaseUrl()),
  },
});
