import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@prisma/client';
import { VERIFY_ET_BANK_KEYS } from './verify-et.constants';
import { VerifyEtClient } from './verify-et.client';
import {
  VerifyDepositInput,
  VerifyDepositResult,
} from './verify-et.types';

@Injectable()
export class VerifyEtService {
  constructor(
    private readonly configService: ConfigService,
    private readonly verifyEtClient: VerifyEtClient,
  ) {}

  async verifyDeposit(input: VerifyDepositInput): Promise<VerifyDepositResult> {
    const requestBody = this.buildRequestBody(input);
    const clientResult = await this.verifyEtClient.submitAndPoll(
      requestBody,
      `${input.provider.toLowerCase()}-${input.reference}`,
    );

    if (clientResult.unavailable) {
      return {
        verified: false,
        settlementMatched: false,
        rawResponse: clientResult.rawResponse,
        requestId: clientResult.requestId,
        errorCode: 'VERIFICATION_UNAVAILABLE',
        reason:
          'Payment verification is temporarily unavailable. Please try again.',
      };
    }

    const record = clientResult.record;
    const recordVerified = record?.verified !== false;
    const recordStatus = record?.status?.trim().toLowerCase();
    const recordSuccess =
      recordStatus === undefined ||
      recordStatus === 'success' ||
      recordStatus === 'completed';
    const verified =
      clientResult.verified === true &&
      Boolean(record) &&
      recordVerified &&
      recordSuccess;

    const settlementMatched = record?.settlementAccountMatch?.matched === true;
    const amount = this.toOptionalString(record?.amount);
    const receiverName = record?.receiverName?.trim() || undefined;

    if (!verified) {
      return {
        verified: false,
        amount,
        receiverName,
        settlementMatched,
        rawResponse: clientResult.rawResponse,
        requestId: clientResult.requestId,
        errorCode: 'INVALID_RECEIPT',
        reason: 'Receipt could not be verified. Check the reference number.',
      };
    }

    if (!settlementMatched) {
      return {
        verified: true,
        amount,
        receiverName,
        settlementMatched: false,
        rawResponse: clientResult.rawResponse,
        requestId: clientResult.requestId,
        errorCode: 'SETTLEMENT_MISMATCH',
        reason: 'This receipt was not paid to the configured settlement account.',
      };
    }

    const currency = record?.currency?.trim().toUpperCase();
    if (currency && currency !== 'ETB') {
      return {
        verified: false,
        amount,
        receiverName,
        settlementMatched,
        rawResponse: clientResult.rawResponse,
        requestId: clientResult.requestId,
        errorCode: 'INVALID_RECEIPT',
        reason: 'Deposit currency is not supported.',
      };
    }

    if (!amount) {
      return {
        verified: true,
        amount,
        receiverName,
        settlementMatched: true,
        rawResponse: clientResult.rawResponse,
        requestId: clientResult.requestId,
        errorCode: 'INVALID_RECEIPT',
        reason: 'Provider amount could not be confirmed.',
      };
    }

    return {
      verified: true,
      amount,
      receiverName,
      settlementMatched: true,
      rawResponse: clientResult.rawResponse,
      requestId: clientResult.requestId,
    };
  }

  private buildRequestBody(
    input: VerifyDepositInput,
  ): Record<string, string> {
    switch (input.provider) {
      case PaymentProvider.TELEBIRR:
        return {
          bank: VERIFY_ET_BANK_KEYS.TELEBIRR,
          transactionNumber: input.reference,
          settlementAccount: this.getRequiredConfig(
            'TELEBIRR_SETTLEMENT_ACCOUNT',
          ),
        };
      case PaymentProvider.CBE: {
        const accountSuffix = this.getCbeAccountSuffix();
        return {
          bank: VERIFY_ET_BANK_KEYS.CBE,
          referenceNumber: input.reference,
          settlementAccount: this.getRequiredConfig('CBE_SETTLEMENT_ACCOUNT'),
          accountSuffix,
          suffix: accountSuffix,
        };
      }
      case PaymentProvider.AWASH:
        return {
          bank: VERIFY_ET_BANK_KEYS.AWASH,
          referenceNumber: input.reference,
          settlementAccount: this.getRequiredConfig('AWASH_SETTLEMENT_ACCOUNT'),
        };
      case PaymentProvider.BOA: {
        const body: Record<string, string> = {
          bank: VERIFY_ET_BANK_KEYS.BOA,
          referenceNumber: input.reference,
          settlementAccount: this.getRequiredConfig('BOA_SETTLEMENT_ACCOUNT'),
        };
        const suffix = this.configService.get<string>('BOA_ACCOUNT_SUFFIX');
        if (suffix?.trim()) {
          body.accountSuffix = suffix.trim();
        }
        return body;
      }
      default:
        throw new Error(`Unsupported deposit provider: ${input.provider}`);
    }
  }

  private getCbeAccountSuffix(): string {
    const explicit =
      this.configService.get<string>('CBE_ACCOUNT_SUFFIX') ??
      this.configService.get<string>('CBE_ACCOUNT_LAST8');

    const explicitDigits = explicit?.replace(/\D/g, '') ?? '';
    if (explicitDigits.length >= 8) {
      return explicitDigits.slice(-8);
    }

    const settlementDigits = this.getRequiredConfig(
      'CBE_SETTLEMENT_ACCOUNT',
    ).replace(/\D/g, '');
    const derivedSuffix = settlementDigits.slice(-8);
    if (derivedSuffix.length === 8) {
      return derivedSuffix;
    }

    throw new Error(
      'CBE_ACCOUNT_SUFFIX must be configured as 8 digits for Verify.ET',
    );
  }

  private getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value?.trim()) {
      throw new Error(`${key} is not configured`);
    }

    return value.trim();
  }

  private toOptionalString(value?: string | number): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return String(value);
  }
}
