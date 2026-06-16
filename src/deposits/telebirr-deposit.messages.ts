import { DepositVerificationCode } from '../payment-verification/types/deposit-verification-result.type';

export const TELEBIRR_DUPLICATE_MESSAGE = 'This receipt has already been used.';
export const TELEBIRR_INVALID_RECEIPT_MESSAGE =
  'Receipt could not be verified. Check the receipt code.';
export const TELEBIRR_AMOUNT_MISMATCH_MESSAGE =
  'Amount does not match this receipt. Please enter the correct amount.';
export const TELEBIRR_RECEIVER_MISMATCH_MESSAGE =
  'This receipt was not paid to Friends Bingo.';
export const TELEBIRR_VERIFICATION_UNAVAILABLE_MESSAGE =
  'Payment verification is temporarily unavailable. Please try again.';
export const TELEBIRR_VERIFY_IN_PROGRESS_MESSAGE =
  'Verification already in progress. Please wait.';
export const TELEBIRR_APPROVED_MESSAGE =
  'Deposit successful. Wallet updated.';
export const TELEBIRR_CAN_VERIFY_MESSAGE =
  'Receipt is available for verification.';

export const TELEBIRR_DEPOSIT_MESSAGES: Record<
  Exclude<DepositVerificationCode, 'APPROVED' | 'CAN_VERIFY'>,
  string
> = {
  ALREADY_USED: TELEBIRR_DUPLICATE_MESSAGE,
  INVALID_RECEIPT: TELEBIRR_INVALID_RECEIPT_MESSAGE,
  AMOUNT_MISMATCH: TELEBIRR_AMOUNT_MISMATCH_MESSAGE,
  RECEIVER_MISMATCH: TELEBIRR_RECEIVER_MISMATCH_MESSAGE,
  VERIFICATION_UNAVAILABLE: TELEBIRR_VERIFICATION_UNAVAILABLE_MESSAGE,
  VERIFY_IN_PROGRESS: TELEBIRR_VERIFY_IN_PROGRESS_MESSAGE,
};
