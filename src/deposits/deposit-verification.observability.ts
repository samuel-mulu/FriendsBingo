import { Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import {
  DepositErrorCode,
  RETRYABLE_DEPOSIT_ERROR_CODES,
} from './deposit-verification.errors';

export type DepositVerificationOutcome =
  | 'approved'
  | 'rejected'
  | 'unavailable'
  | 'pending';

export type DepositVerificationStage =
  | 'submit'
  | 'poll_attempt'
  | 'poll_exhausted'
  | 'submit_network_error'
  | 'poll_network_error'
  | 'completed'
  | 'settlement_candidate'
  | 'local_fetch'
  | 'local_validate'
  | 'evaluate'
  | 'final'
  | 'cancel';

export interface DepositVerificationLogEvent {
  correlationId: string;
  provider?: string;
  approvalMode?: string;
  verificationSource?: string;
  providerRequestId?: string;
  stage: DepositVerificationStage;
  processingStatus?: string;
  pollCount?: number;
  pollElapsedMs?: number;
  httpStatus?: number;
  errorCode?: DepositErrorCode | string;
  retryable?: boolean;
  settlementCandidateIndex?: number;
  outcome?: DepositVerificationOutcome;
  refSuffix?: string;
  idempotencyKeyFingerprint?: string;
  message?: string;
}

export function createDepositVerificationCorrelationId(): string {
  return randomUUID();
}

export function maskDepositRef(ref: string | undefined | null): string {
  const trimmed = ref?.trim() ?? '';
  if (!trimmed) {
    return '***';
  }
  if (trimmed.length <= 4) {
    return `***${trimmed}`;
  }
  return `***${trimmed.slice(-4)}`;
}

export function maskAccountDigits(value: string | undefined | null): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!digits) {
    return '***';
  }
  return `***${digits.slice(-4)}`;
}

export function fingerprintIdempotencyKey(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

export function isRetryableDepositErrorCode(
  code: DepositErrorCode | string | undefined,
): boolean {
  if (!code) {
    return false;
  }
  return RETRYABLE_DEPOSIT_ERROR_CODES.has(code as DepositErrorCode);
}

export function logDepositVerificationEvent(
  logger: Logger,
  event: DepositVerificationLogEvent,
): void {
  const payload: DepositVerificationLogEvent = {
    ...event,
    retryable:
      event.retryable ??
      (event.errorCode
        ? isRetryableDepositErrorCode(event.errorCode)
        : undefined),
  };

  logger.log(JSON.stringify({ event: 'deposit.verification', ...payload }));
}
