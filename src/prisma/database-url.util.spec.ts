import {
  createPgPoolConfig,
  deriveDirectDatabaseUrl,
  resolveDirectDatabaseUrl,
} from './database-url.util';

describe('database-url.util', () => {
  const pooledUrl =
    'postgresql://user:pass@ep-rough-flower-aqtbm7yt-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require';
  const directUrl =
    'postgresql://user:pass@ep-rough-flower-aqtbm7yt.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require';

  it('derives direct Neon URL from pooler URL', () => {
    expect(deriveDirectDatabaseUrl(pooledUrl)).toBe(directUrl);
  });

  it('returns non-pooler URLs unchanged', () => {
    expect(deriveDirectDatabaseUrl(directUrl)).toBe(directUrl);
  });

  it('prefers explicit DIRECT_URL when set', () => {
    const explicit =
      'postgresql://user:pass@custom-host.example.com:5432/neondb?sslmode=require';

    expect(resolveDirectDatabaseUrl(pooledUrl, explicit)).toBe(explicit);
  });

  it('falls back to derived direct URL when DIRECT_URL is blank', () => {
    expect(resolveDirectDatabaseUrl(pooledUrl, '   ')).toBe(directUrl);
  });

  it('builds pg pool config with keep-alive and timeouts', () => {
    expect(createPgPoolConfig(directUrl, 12)).toEqual({
      connectionString: directUrl,
      max: 12,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 15_000,
      keepAlive: true,
      allowExitOnIdle: false,
    });
  });
});
