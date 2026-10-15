import { PaymentProvider } from '@prisma/client';
import { DepositErrorCode } from '../deposits/deposit-verification.errors';

export type VerifyEtDepositErrorCode = Extract<
  DepositErrorCode,
  | 'AMOUNT_MISMATCH'
  | 'SETTLEMENT_MISMATCH'
  | 'INVALID_TRANSACTION'
  | 'INVALID_RECEIPT'
  | 'VERIFICATION_PENDING'
  | 'VERIFICATION_UNAVAILABLE'
  | 'INTERNAL_ERROR'
>;

export interface VerifyDepositInput {
  provider: PaymentProvider;
  reference: string;
  amount: string;
  correlationId?: string;
  onRequestId?: (requestId: string) => void | Promise<void>;
  maxPollAttempts?: number;
  /** When set, only GET-poll this request (no new POST). */
  existingRequestId?: string;
  settlementCandidateIndex?: number;
}

export interface VerifyDepositResult {
  verified: boolean;
  amount?: string;
  receiverName?: string;
  settlementMatched: boolean;
  matchedSettlementAccount?: string;
  rawResponse: Record<string, unknown>;
  requestId?: string;
  processingStatus?: string;
  errorCode?: VerifyEtDepositErrorCode;
  reason?: string;
  pollCount?: number;
  pollElapsedMs?: number;
}
