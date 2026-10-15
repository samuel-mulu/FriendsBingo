import {
  fingerprintIdempotencyKey,
  isRetryableDepositErrorCode,
  maskAccountDigits,
  maskDepositRef,
} from './deposit-verification.observability';

describe('deposit-verification.observability', () => {
  it('masks transaction references to a suffix', () => {
    expect(maskDepositRef('DGS1BJ2WJ3')).toBe('***2WJ3');
    expect(maskDepositRef('AB')).toBe('***AB');
  });

  it('masks account digits to last4', () => {
    expect(maskAccountDigits('2519****3287')).toBe('***3287');
    expect(maskAccountDigits('0952723287')).toBe('***3287');
  });

  it('fingerprints idempotency keys without exposing the full key', () => {
    const fingerprint = fingerprintIdempotencyKey('deposit-telebirr-abc-deadbeef');
    expect(fingerprint).toHaveLength(12);
    expect(fingerprint).not.toContain('telebirr');
  });

  it('classifies retryable versus permanent error codes', () => {
    expect(isRetryableDepositErrorCode('VERIFICATION_PENDING')).toBe(true);
    expect(isRetryableDepositErrorCode('VERIFICATION_UNAVAILABLE')).toBe(true);
    expect(isRetryableDepositErrorCode('AMOUNT_MISMATCH')).toBe(false);
    expect(isRetryableDepositErrorCode('INVALID_TRANSACTION')).toBe(false);
  });
});
