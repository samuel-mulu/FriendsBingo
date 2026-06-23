import { PaymentProvider } from '@prisma/client';

export type VerifyEtDepositErrorCode =
  | 'AMOUNT_MISMATCH'
  | 'SETTLEMENT_MISMATCH'
  | 'INVALID_RECEIPT'
  | 'VERIFICATION_UNAVAILABLE';

export interface VerifyDepositInput {
  provider: PaymentProvider;
  reference: string;
  amount: string;
}

export interface VerifyDepositResult {
  verified: boolean;
  amount?: string;
  receiverName?: string;
  settlementMatched: boolean;
  rawResponse: Record<string, unknown>;
  requestId?: string;
  errorCode?: VerifyEtDepositErrorCode;
  reason?: string;
}
