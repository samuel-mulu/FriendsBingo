import {
  createLazyCorsOriginChecker,
  isOriginAllowedByCorsConfig,
  readCorsOriginsFromEnv,
  resolveHttpCorsOptions,
  resolveWebSocketCorsOptions,
} from './cors.config';

describe('cors.config', () => {
  const originalCorsOrigins = process.env.CORS_ORIGINS;

  afterEach(() => {
    if (originalCorsOrigins === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = originalCorsOrigins;
    }
  });

  it('uses the same allowed origins for HTTP and WebSocket', () => {
    process.env.CORS_ORIGINS =
      'http://localhost:3000,https://admin.example.com';

    const httpOptions = resolveHttpCorsOptions(readCorsOriginsFromEnv());
    const socketOrigins = resolveWebSocketCorsOptions(readCorsOriginsFromEnv());

    expect(httpOptions.origin).toEqual([
      'http://localhost:3000',
      'https://admin.example.com',
    ]);
    expect(socketOrigins).toEqual(httpOptions.origin);
  });

  it('allows flutter web dev ports via localhost wildcard patterns', () => {
    expect(
      isOriginAllowedByCorsConfig(
        'http://localhost:64853',
        'http://localhost:*',
      ),
    ).toBe(true);
    expect(
      isOriginAllowedByCorsConfig(
        'https://localhost:64853',
        'http://localhost:*',
      ),
    ).toBe(false);
  });

  it('allows native mobile clients that do not send Origin', () => {
    expect(
      isOriginAllowedByCorsConfig(
        undefined,
        'https://friends-bingo-admin.vercel.app',
      ),
    ).toBe(true);
  });

  it('rejects browser origins that are not allowlisted', () => {
    expect(
      isOriginAllowedByCorsConfig(
        'https://evil.example.com',
        'https://friends-bingo-admin.vercel.app',
      ),
    ).toBe(false);
  });

  it('reads CORS_ORIGINS lazily for socket polling preflight', async () => {
    process.env.CORS_ORIGINS = 'http://localhost:64853';
    const checker = createLazyCorsOriginChecker();

    await expect(
      new Promise<boolean>((resolve, reject) => {
        checker('http://localhost:64853', (error, allow) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(allow === true);
        });
      }),
    ).resolves.toBe(true);
  });
});
