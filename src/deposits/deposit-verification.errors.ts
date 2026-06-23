export type DepositErrorCode =
  | 'ALREADY_USED'
  | 'AMOUNT_MISMATCH'
  | 'SETTLEMENT_MISMATCH'
  | 'INVALID_RECEIPT'
  | 'VERIFICATION_UNAVAILABLE';

export const DEPOSIT_ERROR_MESSAGES: Record<DepositErrorCode, string> = {
  ALREADY_USED: 'This receipt has already been used.',
  INVALID_RECEIPT:
    'Receipt could not be verified. Check the reference number.',
  AMOUNT_MISMATCH:
    'Amount does not match this receipt. Please enter the correct amount.',
  SETTLEMENT_MISMATCH:
    'This receipt was not paid to the configured settlement account.',
  VERIFICATION_UNAVAILABLE:
    'Payment verification is temporarily unavailable. Please try again.',
};

export const DEPOSIT_CHECK_REF_OK_MESSAGE =
  'Reference is available for deposit submission.';
export const DEPOSIT_APPROVED_MESSAGE = 'Deposit successful. Wallet updated.';
