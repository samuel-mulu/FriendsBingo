import { envValidationSchema, validateCorsOrigins } from './env.validation';

describe('validateCorsOrigins', () => {
  it('rejects wildcard in production', () => {
    expect(validateCorsOrigins('*', { production: true })).toEqual({
      ok: false,
      message: expect.stringContaining('cannot be "*"'),
    });
  });

  it('allows wildcard in development and test', () => {
    expect(validateCorsOrigins('*', { production: false })).toEqual({
      ok: true,
      normalized: '*',
    });
  });

  it('accepts comma-separated production URLs', () => {
    expect(
      validateCorsOrigins(
        'https://friends-bingo-admin.vercel.app,https://friends-bingo.web.app',
        { production: true },
      ),
    ).toEqual({
      ok: true,
      normalized:
        'https://friends-bingo-admin.vercel.app,https://friends-bingo.web.app',
    });
  });

  it('allows localhost wildcard patterns only outside production', () => {
    expect(
      validateCorsOrigins('http://localhost:*', { production: false }),
    ).toEqual({
      ok: true,
      normalized: 'http://localhost:*',
    });
    expect(
      validateCorsOrigins('http://localhost:*', { production: true }),
    ).toEqual({
      ok: false,
      message: expect.stringContaining('cannot use wildcards'),
    });
  });
});

describe('envValidationSchema CORS_ORIGINS', () => {
  const baseEnv = {
    NODE_ENV: 'production',
    PORT: 10000,
    DATABASE_URL: 'postgresql://user:pass@host:5432/db',
    JWT_SECRET: 'super-secret-key-123',
    JWT_EXPIRES_IN: '7d',
    CBE_ACCOUNT_NUMBER: '1234567890',
    CBE_ACCOUNT_LAST8: '12345678',
    TELEBIRR_RECEIVER_PHONE: '0911223344',
    TELEBIRR_RECEIPT_BASE_URL: 'https://transactioninfo.ethiotelecom.et/receipt',
    TELEBIRR_SETTLEMENT_ACCOUNT: '0962520885',
    VERIFY_ET_API_KEY: 'verify-et-test-key',
    VERIFY_ET_BASE_URL: 'https://verify.et',
    VERIFY_ET_WAIT_MS: 5000,
    VERIFY_ET_POLL_ATTEMPTS: 10,
    VERIFY_ET_POLL_INTERVAL_MS: 1500,
  };

  it('fails with a helpful message when CORS_ORIGINS is *', () => {
    const { error } = envValidationSchema.validate({
      ...baseEnv,
      CORS_ORIGINS: '*',
    });

    expect(error?.details?.[0]?.message).toContain('cannot be "*" in production');
    expect(error?.details?.[0]?.message).toContain('https://');
  });

  it('accepts explicit production frontend URLs', () => {
    const { error, value } = envValidationSchema.validate({
      ...baseEnv,
      CORS_ORIGINS:
        'https://friends-bingo-admin.vercel.app,https://friends-bingo.web.app',
    });

    expect(error).toBeUndefined();
    expect(value.CORS_ORIGINS).toBe(
      'https://friends-bingo-admin.vercel.app,https://friends-bingo.web.app',
    );
  });

  it('defaults to wildcard CORS outside production', () => {
    const { error, value } = envValidationSchema.validate({
      ...baseEnv,
      NODE_ENV: 'development',
      CORS_ORIGINS: undefined,
    });

    expect(error).toBeUndefined();
    expect(value.CORS_ORIGINS).toBe('*');
  });
});
