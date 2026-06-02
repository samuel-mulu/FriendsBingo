import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { DepositVerificationProvider } from '../interfaces/deposit-verification-provider.interface';
import { DepositVerificationResult } from '../types/deposit-verification-result.type';
import { VerifyDepositInput } from '../types/verify-deposit-input.type';

@Injectable()
export class CbeDepositVerifier implements DepositVerificationProvider {
  readonly provider = PaymentProvider.CBE;

  async verify(input: VerifyDepositInput): Promise<DepositVerificationResult> {
    return {
      verified: false,
      status: 'MANUAL_REVIEW',
      provider: this.provider,
      transactionRef: input.transactionRef,
      reason: 'CBE automatic verification is not implemented yet',
      raw: {
        todo: [
          'Plug in cbe-verifier or ethiobank-receipts integration',
          'Normalize receiver account, receiver name, paid amount, and paid time',
          'Map provider-specific errors into structured verification outcomes',
        ],
      },
    };
  }
}
