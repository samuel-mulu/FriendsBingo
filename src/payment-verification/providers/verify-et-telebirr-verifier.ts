import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@prisma/client';
import { VerifyDepositInput } from '../types/verify-deposit-input.type';
import { VerifyEtBaseVerifier } from './verify-et-base.verifier';

@Injectable()
export class VerifyEtTelebirrVerifier extends VerifyEtBaseVerifier {
  readonly provider = PaymentProvider.TELEBIRR;

  constructor(configService: ConfigService) {
    super(configService);
  }

  protected buildRequestBody(
    input: VerifyDepositInput,
  ): Record<string, string> {
    return {
      bank: 'telebirr',
      transactionNumber: input.transactionRef,
      settlementAccount: this.getRequiredConfig('TELEBIRR_SETTLEMENT_ACCOUNT'),
    };
  }

  protected isReceiverMismatch(
    record:
      | {
          settlementAccountMatch?: {
            matched?: boolean;
          };
        }
      | undefined,
  ): boolean {
    return record?.settlementAccountMatch?.matched === false;
  }
}
