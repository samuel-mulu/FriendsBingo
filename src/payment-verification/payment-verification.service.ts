import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { DepositVerificationProvider } from './interfaces/deposit-verification-provider.interface';
import { CbeDepositVerifier } from './providers/cbe-deposit-verifier';
import { VerifyEtTelebirrVerifier } from './providers/verify-et-telebirr-verifier';
import { DepositVerificationResult } from './types/deposit-verification-result.type';
import { VerifyDepositInput } from './types/verify-deposit-input.type';

@Injectable()
export class PaymentVerificationService {
  private readonly providerMap: Map<
    PaymentProvider,
    DepositVerificationProvider
  >;

  constructor(
    cbeDepositVerifier: CbeDepositVerifier,
    telebirrDepositVerifier: VerifyEtTelebirrVerifier,
  ) {
    this.providerMap = new Map(
      [cbeDepositVerifier, telebirrDepositVerifier].map((provider) => [
        provider.provider,
        provider,
      ]),
    );
  }

  async verifyDeposit(
    input: VerifyDepositInput,
  ): Promise<DepositVerificationResult> {
    const provider = this.providerMap.get(input.provider);

    if (!provider) {
      return {
        verified: false,
        status: 'MANUAL_REVIEW',
        provider: input.provider,
        transactionRef: input.transactionRef,
        reason: 'Unsupported payment provider for automatic verification',
      };
    }

    return provider.verify(input);
  }
}
