import {
  ACTIVE_VERIFICATION_ATTEMPT_STATUSES,
  VERIFICATION_SUBMIT_AMBIGUITY_MS,
} from './deposit-verification-attempt.constants';
import { DepositVerificationAttemptStatus } from '@prisma/client';

describe('DepositVerificationAttempt resume policy', () => {
  it('treats submitting/awaiting/ambiguous as active', () => {
    expect(ACTIVE_VERIFICATION_ATTEMPT_STATUSES).toEqual(
      expect.arrayContaining([
        DepositVerificationAttemptStatus.SUBMITTING,
        DepositVerificationAttemptStatus.AWAITING_PROVIDER,
        DepositVerificationAttemptStatus.AMBIGUOUS,
      ]),
    );
    expect(ACTIVE_VERIFICATION_ATTEMPT_STATUSES).not.toContain(
      DepositVerificationAttemptStatus.SUCCEEDED,
    );
    expect(ACTIVE_VERIFICATION_ATTEMPT_STATUSES).not.toContain(
      DepositVerificationAttemptStatus.FAILED,
    );
  });

  it('keeps ambiguity constant for docs only; runtime fail-closes without timed re-POST', () => {
    // VERIFICATION_SUBMIT_AMBIGUITY_MS is deprecated: without a persisted
    // providerRequestId, SUBMITTING/AMBIGUOUS never open a second Verify.ET POST
    // until the attempt expires and a new attempt row may be created.
    expect(VERIFICATION_SUBMIT_AMBIGUITY_MS).toBe(60_000);
    expect(ACTIVE_VERIFICATION_ATTEMPT_STATUSES).toContain(
      DepositVerificationAttemptStatus.AMBIGUOUS,
    );
  });
});
