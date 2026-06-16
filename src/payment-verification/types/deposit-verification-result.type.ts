import { PaymentProvider } from '@prisma/client';

export type DepositVerificationStatus =
  | 'VERIFIED'
  | 'INVALID'
  | 'PENDING'
  | 'ERROR'
  | 'MANUAL_REVIEW';

export type DepositVerificationCode =
  | 'ALREADY_USED'
  | 'INVALID_RECEIPT'
  | 'AMOUNT_MISMATCH'
  | 'RECEIVER_MISMATCH'
  | 'VERIFICATION_UNAVAILABLE'
  | 'VERIFY_IN_PROGRESS'
  | 'APPROVED'
  | 'CAN_VERIFY';

export interface DepositVerificationResult {
  verified: boolean;
  status: DepositVerificationStatus;
  provider: PaymentProvider;
  transactionRef: string;
  code?: DepositVerificationCode;
  amount?: string;
  currency?: string;
  payerName?: string;
  payerAccount?: string;
  receiverName?: string;
  receiverAccount?: string;
  paidAt?: Date;
  requestId?: string;
  verificationSource?: string;
  raw?: unknown;
  reason?: string;
}
