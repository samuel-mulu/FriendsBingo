import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@prisma/client';
import { VerifyDepositInput } from '../types/verify-deposit-input.type';
import { VerifyEtBaseVerifier } from './verify-et-base.verifier';

@Injectable()
export class BoaDepositVerifier extends VerifyEtBaseVerifier {
  readonly provider = PaymentProvider.BOA;

  constructor(configService: ConfigService) {
    super(configService);
  }

  protected buildRequestBody(
    input: VerifyDepositInput,
  ): Record<string, string> {
    return {
      bank: 'boa',
      referenceNumber: input.transactionRef,
      accountSuffix: this.getRequiredConfig('BOA_ACCOUNT_SUFFIX'),
    };
  }
}
