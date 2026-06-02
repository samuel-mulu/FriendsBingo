import { PaymentProvider } from '@prisma/client';

export type DepositVerificationStatus =
  | 'VERIFIED'
  | 'INVALID'
  | 'PENDING'
  | 'ERROR'
  | 'MANUAL_REVIEW';

export interface DepositVerificationResult {
  verified: boolean;
  status: DepositVerificationStatus;
  provider: PaymentProvider;
  transactionRef: string;
  amount?: string;
  currency?: string;
  payerName?: string;
  payerAccount?: string;
  receiverName?: string;
  receiverAccount?: string;
  paidAt?: Date;
  raw?: unknown;
  reason?: string;
}
