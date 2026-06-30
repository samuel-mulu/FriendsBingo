import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';
import { deriveDirectDatabaseUrl } from './src/prisma/database-url.util';

function withConnectTimeout(url: string): string {
  if (url.includes('connect_timeout=')) {
    return url;
  }

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connect_timeout=30`;
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
