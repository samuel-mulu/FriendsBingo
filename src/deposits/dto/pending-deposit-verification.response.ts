import { PaymentProvider } from '@prisma/client';

export interface PendingDepositVerificationResponse {
  verificationStatus: 'pending';
  attemptId: string;
  code: 'VERIFICATION_PENDING' | 'VERIFICATION_UNAVAILABLE';
  message: string;
  retryAfterSeconds: number;
  provider: PaymentProvider;
  amount: string;
  transactionRef: string;
}

export function isPendingDepositVerificationResponse(
  value: unknown,
): value is PendingDepositVerificationResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PendingDepositVerificationResponse).verificationStatus ===
      'pending'
  );
}
