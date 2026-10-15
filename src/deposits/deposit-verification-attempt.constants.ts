import { DepositVerificationAttemptStatus } from '@prisma/client';

export const ACTIVE_VERIFICATION_ATTEMPT_STATUSES: DepositVerificationAttemptStatus[] =
  [
    DepositVerificationAttemptStatus.SUBMITTING,
    DepositVerificationAttemptStatus.AWAITING_PROVIDER,
    DepositVerificationAttemptStatus.AMBIGUOUS,
  ];

/** Provider-documented poll window is ~125s; keep attempt recoverable longer. */
export const VERIFICATION_ATTEMPT_TTL_MS = 15 * 60 * 1000;

/**
 * @deprecated Fail-closed: ambiguous attempts never re-POST until EXPIRED.
 * Kept for tests/docs only; runtime no longer uses a timed reopen window.
 */
export const VERIFICATION_SUBMIT_AMBIGUITY_MS = 60 * 1000;

export const VERIFICATION_CHECK_POLL_ATTEMPTS = 5;
export const VERIFICATION_INITIAL_POLL_ATTEMPTS = 8;

export const DEFAULT_VERIFICATION_RETRY_AFTER_SECONDS = 5;
