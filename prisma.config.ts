import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

function withConnectTimeout(url: string): string {
  if (url.includes('connect_timeout=')) {
    return url;
  }

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connect_timeout=30`;
}

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    path: './prisma/migrations',
  },
  datasource: {
    // Same DATABASE_URL you used when deploys worked before.
    // Optional: set DIRECT_URL in Render only if P1002 keeps happening.
    url: withConnectTimeout(
      process.env.DIRECT_URL?.trim() || env('DATABASE_URL'),
    ),
  },
});
