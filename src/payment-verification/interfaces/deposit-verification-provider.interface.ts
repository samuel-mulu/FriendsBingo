import { PaymentProvider } from '@prisma/client';
import { DepositVerificationResult } from '../types/deposit-verification-result.type';
import { VerifyDepositInput } from '../types/verify-deposit-input.type';

export interface DepositVerificationProvider {
  provider: PaymentProvider;
  verify(input: VerifyDepositInput): Promise<DepositVerificationResult>;
}
