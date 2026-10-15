export type DepositErrorCode =
  | 'ALREADY_USED'
  | 'UNDER_REVIEW'
  | 'AMOUNT_MISMATCH'
  | 'SETTLEMENT_MISMATCH'
  | 'INVALID_TRANSACTION'
  /** @deprecated Prefer INVALID_TRANSACTION for permanent invalid payments. */
  | 'INVALID_RECEIPT'
  | 'VERIFICATION_PENDING'
  | 'VERIFICATION_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const INVALID_PAYMENT_MESSAGE =
  'Receipt could not be verified. Check the reference number.';

export const DEPOSIT_ERROR_MESSAGES: Record<DepositErrorCode, string> = {
  ALREADY_USED: 'This receipt has already been used.',
  UNDER_REVIEW:
    'This receipt is already under admin review. Wait for approval or rejection.',
  INVALID_TRANSACTION: INVALID_PAYMENT_MESSAGE,
  INVALID_RECEIPT: INVALID_PAYMENT_MESSAGE,
  AMOUNT_MISMATCH:
    'Amount does not match this receipt. Please enter the correct amount.',
  SETTLEMENT_MISMATCH:
    'This receipt was not paid to the configured settlement account.',
  VERIFICATION_PENDING:
    'Payment verification is still processing. Please try again shortly.',
  VERIFICATION_UNAVAILABLE:
    'Payment verification is temporarily unavailable. Please try again.',
  INTERNAL_ERROR:
    'Deposit verification failed due to an internal error. Please try again.',
};

export const RETRYABLE_DEPOSIT_ERROR_CODES: ReadonlySet<DepositErrorCode> =
  new Set([
    'VERIFICATION_PENDING',
    'VERIFICATION_UNAVAILABLE',
    'INTERNAL_ERROR',
  ]);

export const DEPOSIT_CHECK_REF_OK_MESSAGE =
  'Reference is available for deposit submission.';
export const DEPOSIT_APPROVED_MESSAGE = 'Deposit successful. Wallet updated.';
