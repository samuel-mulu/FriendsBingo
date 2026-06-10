import {
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
});
