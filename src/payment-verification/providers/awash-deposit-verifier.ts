import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@prisma/client';
import { VerifyDepositInput } from '../types/verify-deposit-input.type';
import { VerifyEtBaseVerifier } from './verify-et-base.verifier';

@Injectable()
export class AwashDepositVerifier extends VerifyEtBaseVerifier {
  readonly provider = PaymentProvider.AWASH;

  constructor(configService: ConfigService) {
    super(configService);
  }

  protected buildRequestBody(
    input: VerifyDepositInput,
  ): Record<string, string> {
    return {
      bank: 'awash',
      referenceNumber: input.transactionRef,
    };
  }
}
