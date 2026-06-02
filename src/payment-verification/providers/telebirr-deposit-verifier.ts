import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { DepositVerificationProvider } from '../interfaces/deposit-verification-provider.interface';
import { DepositVerificationResult } from '../types/deposit-verification-result.type';
import { VerifyDepositInput } from '../types/verify-deposit-input.type';

@Injectable()
export class TelebirrDepositVerifier implements DepositVerificationProvider {
  readonly provider = PaymentProvider.TELEBIRR;

  async verify(input: VerifyDepositInput): Promise<DepositVerificationResult> {
    return {
      verified: false,
      status: 'MANUAL_REVIEW',
      provider: this.provider,
      transactionRef: input.transactionRef,
      reason: 'Telebirr automatic verification is not implemented yet',
      raw: {
        todo: [
          'Plug in telebirr-receipt, Verify.ET, or ShegerPay integration',
          'Normalize receiver phone, receiver name, paid amount, and paid time',
          'Map provider-specific errors into structured verification outcomes',
        ],
      },
    };
  }
}
