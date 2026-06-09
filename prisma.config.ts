import 'dotenv/config';
import { defineConfig } from 'prisma/config';

function withConnectTimeout(url: string): string {
  if (url.includes('connect_timeout=')) {
    return url;
  }

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connect_timeout=30`;
}

/**
 * Prisma Migrate needs a direct Postgres connection.
 * Neon pooler URLs (-pooler host) cannot acquire advisory locks (P1002).
 */
function resolveMigrationDatabaseUrl(): string {
  const directUrl = process.env.DIRECT_URL?.trim();
  if (directUrl) {
    return withConnectTimeout(directUrl);
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. For Neon, also set DIRECT_URL to the non-pooler connection.',
    );
  }

  if (databaseUrl.includes('-pooler.')) {
    return withConnectTimeout(databaseUrl.replace('-pooler.', '.'));
  }

  return withConnectTimeout(databaseUrl);
}

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    path: './prisma/migrations',
  },
  datasource: {
    url: resolveMigrationDatabaseUrl(),
  },
});
