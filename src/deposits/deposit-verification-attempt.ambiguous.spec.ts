import { DepositVerificationAttemptStatus } from '@prisma/client';

/**
 * Mirrors DepositsService.shouldAvoidNewProviderSubmit (fail-closed).
 * Provider request lifetime / idempotency replay is not documented in-repo;
 * without a requestId we never open a second POST until attempt expiry.
 */
function shouldAvoidNewProviderSubmit(
  attempt: {
    providerRequestId: string | null;
    status: DepositVerificationAttemptStatus;
    lastErrorCode: string | null;
  },
  allowNewSubmit: boolean,
): boolean {
  if (attempt.providerRequestId) {
    return false;
  }
  if (attempt.status === DepositVerificationAttemptStatus.AMBIGUOUS) {
    return true;
  }
  if (attempt.status === DepositVerificationAttemptStatus.AWAITING_PROVIDER) {
    return true;
  }
  if (attempt.status === DepositVerificationAttemptStatus.SUBMITTING) {
    if (!allowNewSubmit) {
      return true;
    }
    return attempt.lastErrorCode === 'SUBMIT_IN_FLIGHT';
  }
  return false;
}

describe('DepositVerificationAttempt ambiguous submit safety', () => {
  it('allows the first submitter on fresh SUBMITTING', () => {
    expect(
      shouldAvoidNewProviderSubmit(
        {
          providerRequestId: null,
          status: DepositVerificationAttemptStatus.SUBMITTING,
          lastErrorCode: null,
        },
        true,
      ),
    ).toBe(false);
  });

  it('blocks Check Again from POSTing while SUBMITTING without requestId', () => {
    expect(
      shouldAvoidNewProviderSubmit(
        {
          providerRequestId: null,
          status: DepositVerificationAttemptStatus.SUBMITTING,
          lastErrorCode: null,
        },
        false,
      ),
    ).toBe(true);
  });

  it('blocks concurrent submit once SUBMIT_IN_FLIGHT is claimed', () => {
    expect(
      shouldAvoidNewProviderSubmit(
        {
          providerRequestId: null,
          status: DepositVerificationAttemptStatus.SUBMITTING,
          lastErrorCode: 'SUBMIT_IN_FLIGHT',
        },
        true,
      ),
    ).toBe(true);
  });

  it('blocks new POST while AMBIGUOUS without requestId (no timed reopen)', () => {
    expect(
      shouldAvoidNewProviderSubmit(
        {
          providerRequestId: null,
          status: DepositVerificationAttemptStatus.AMBIGUOUS,
          lastErrorCode: null,
        },
        true,
      ),
    ).toBe(true);
  });

  it('allows GET resume when requestId is persisted', () => {
    expect(
      shouldAvoidNewProviderSubmit(
        {
          providerRequestId: 'req-1',
          status: DepositVerificationAttemptStatus.AMBIGUOUS,
          lastErrorCode: null,
        },
        false,
      ),
    ).toBe(false);
  });

  it('blocks new POST while AWAITING_PROVIDER without requestId', () => {
    expect(
      shouldAvoidNewProviderSubmit(
        {
          providerRequestId: null,
          status: DepositVerificationAttemptStatus.AWAITING_PROVIDER,
          lastErrorCode: null,
        },
        true,
      ),
    ).toBe(true);
  });
});
