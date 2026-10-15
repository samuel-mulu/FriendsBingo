import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@prisma/client';
import { DEPOSIT_ERROR_MESSAGES } from '../deposits/deposit-verification.errors';
import {
  logDepositVerificationEvent,
  maskAccountDigits,
  maskDepositRef,
} from '../deposits/deposit-verification.observability';
import { VERIFY_ET_BANK_KEYS } from './verify-et.constants';
import { VerifyEtClient } from './verify-et.client';
import { VerifyDepositInput, VerifyDepositResult } from './verify-et.types';

@Injectable()
export class VerifyEtService {
  private readonly logger = new Logger(VerifyEtService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly verifyEtClient: VerifyEtClient,
  ) {}

  async verifyDeposit(input: VerifyDepositInput): Promise<VerifyDepositResult> {
    if (input.existingRequestId) {
      return this.pollExistingAndEvaluate(input, input.existingRequestId);
    }

    if (input.provider === PaymentProvider.TELEBIRR) {
      return this.verifyTelebirrDeposit(input);
    }

    const requestBody = this.buildRequestBody(input);
    return this.submitAndEvaluate(input, requestBody);
  }

  private async verifyTelebirrDeposit(
    input: VerifyDepositInput,
  ): Promise<VerifyDepositResult> {
    const settlementAccounts = this.getTelebirrSettlementAccounts();
    let lastResult: VerifyDepositResult | undefined;
    const correlationId = input.correlationId ?? 'unspecified';

    for (let index = 0; index < settlementAccounts.length; index += 1) {
      const settlementAccount = settlementAccounts[index];
      const requestBody = {
        bank: VERIFY_ET_BANK_KEYS.TELEBIRR,
        transactionNumber: input.reference,
        settlementAccount,
      };
      const result = await this.submitAndEvaluate(input, requestBody);

      logDepositVerificationEvent(this.logger, {
        correlationId,
        provider: input.provider,
        approvalMode: 'automatic',
        verificationSource: 'verify.et',
        providerRequestId: result.requestId,
        stage: 'settlement_candidate',
        processingStatus: result.processingStatus,
        pollCount: result.pollCount,
        pollElapsedMs: result.pollElapsedMs,
        errorCode: result.errorCode,
        settlementCandidateIndex: index,
        outcome: result.verified
          ? result.settlementMatched
            ? 'approved'
            : 'rejected'
          : result.errorCode === 'VERIFICATION_PENDING'
            ? 'pending'
            : result.errorCode === 'VERIFICATION_UNAVAILABLE'
              ? 'unavailable'
              : 'rejected',
        refSuffix: maskDepositRef(input.reference),
        message: `settlementCandidate=${maskAccountDigits(settlementAccount)} verified=${result.verified} matched=${result.settlementMatched}`,
      });

      if (result.verified && result.settlementMatched) {
        return {
          ...result,
          matchedSettlementAccount: settlementAccount,
        };
      }

      lastResult = result;

      // Documented behavior: verified:false stops the dual-settlement loop.
      // Do not treat this as settlement mismatch without Verify.ET evidence.
      if (!result.verified) {
        return result;
      }

      const hasAlternateAccount = index < settlementAccounts.length - 1;
      if (!result.settlementMatched && hasAlternateAccount) {
        continue;
      }

      return result;
    }

    return (
      lastResult ?? {
        verified: false,
        settlementMatched: false,
        rawResponse: {},
        errorCode: 'INVALID_TRANSACTION',
        reason: DEPOSIT_ERROR_MESSAGES.INVALID_TRANSACTION,
      }
    );
  }

  private async pollExistingAndEvaluate(
    input: VerifyDepositInput,
    requestId: string,
  ): Promise<VerifyDepositResult> {
    const clientResult = await this.verifyEtClient.pollExistingRequest(
      requestId,
      {
        correlationId: input.correlationId,
        provider: input.provider,
        referenceSuffix: maskDepositRef(input.reference),
        maxPollAttempts: input.maxPollAttempts ?? 5,
      },
    );
    return this.evaluateClientResult(clientResult);
  }

  private async submitAndEvaluate(
    input: VerifyDepositInput,
    requestBody: Record<string, string>,
  ): Promise<VerifyDepositResult> {
    const clientResult = await this.verifyEtClient.submitAndPoll(
      requestBody,
      `${input.provider.toLowerCase()}-${input.reference}`,
      {
        correlationId: input.correlationId,
        provider: input.provider,
        referenceSuffix: maskDepositRef(input.reference),
        onRequestId: input.onRequestId,
        maxPollAttempts: input.maxPollAttempts,
      },
    );

    return this.evaluateClientResult(clientResult);
  }

  private evaluateClientResult(
    clientResult: Awaited<
      ReturnType<VerifyEtClient['submitAndPoll']>
    >,
  ): VerifyDepositResult {
    if (clientResult.unavailable) {
      const pending =
        clientResult.processingStatus?.trim().toLowerCase() === 'pending';
      return {
        verified: false,
        settlementMatched: false,
        rawResponse: clientResult.rawResponse,
        requestId: clientResult.requestId,
        processingStatus: clientResult.processingStatus,
        pollCount: clientResult.pollCount,
        pollElapsedMs: clientResult.pollElapsedMs,
        errorCode: pending
          ? 'VERIFICATION_PENDING'
          : 'VERIFICATION_UNAVAILABLE',
        reason: pending
          ? DEPOSIT_ERROR_MESSAGES.VERIFICATION_PENDING
          : DEPOSIT_ERROR_MESSAGES.VERIFICATION_UNAVAILABLE,
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
        processingStatus: clientResult.processingStatus,
        pollCount: clientResult.pollCount,
        pollElapsedMs: clientResult.pollElapsedMs,
        errorCode: 'INVALID_TRANSACTION',
        reason: DEPOSIT_ERROR_MESSAGES.INVALID_TRANSACTION,
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
        processingStatus: clientResult.processingStatus,
        pollCount: clientResult.pollCount,
        pollElapsedMs: clientResult.pollElapsedMs,
        errorCode: 'SETTLEMENT_MISMATCH',
        reason: DEPOSIT_ERROR_MESSAGES.SETTLEMENT_MISMATCH,
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
        processingStatus: clientResult.processingStatus,
        pollCount: clientResult.pollCount,
        pollElapsedMs: clientResult.pollElapsedMs,
        errorCode: 'INVALID_TRANSACTION',
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
        processingStatus: clientResult.processingStatus,
        pollCount: clientResult.pollCount,
        pollElapsedMs: clientResult.pollElapsedMs,
        errorCode: 'INVALID_TRANSACTION',
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
      processingStatus: clientResult.processingStatus,
      pollCount: clientResult.pollCount,
      pollElapsedMs: clientResult.pollElapsedMs,
    };
  }

  private buildRequestBody(input: VerifyDepositInput): Record<string, string> {
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
        const accountSuffix = this.getBoaAccountSuffix();
        return {
          bank: VERIFY_ET_BANK_KEYS.BOA,
          referenceNumber: input.reference,
          settlementAccount: this.getRequiredConfig('BOA_SETTLEMENT_ACCOUNT'),
          accountSuffix,
        };
      }
      default:
        throw new Error(`Unsupported deposit provider: ${input.provider}`);
    }
  }

  private getTelebirrSettlementAccounts(): string[] {
    const primary = this.getRequiredConfig('TELEBIRR_SETTLEMENT_ACCOUNT');
    const secondary = this.configService
      .get<string>('TELEBIRR_SETTLEMENT_ACCOUNT_2')
      ?.trim();

    if (secondary) {
      return [primary, secondary];
    }

    return [primary];
  }

  private getBoaAccountSuffix(): string {
    const explicit = this.configService.get<string>('BOA_ACCOUNT_SUFFIX');
    const explicitDigits = explicit?.replace(/\D/g, '') ?? '';
    if (explicitDigits.length >= 5) {
      return explicitDigits.slice(-5);
    }

    const settlementDigits = this.getRequiredConfig(
      'BOA_SETTLEMENT_ACCOUNT',
    ).replace(/\D/g, '');
    const derivedSuffix = settlementDigits.slice(-5);
    if (derivedSuffix.length === 5) {
      return derivedSuffix;
    }

    throw new Error(
      'BOA_ACCOUNT_SUFFIX must resolve to 5 digits for Verify.ET (set it explicitly or use a BOA_SETTLEMENT_ACCOUNT with at least 5 digits)',
    );
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
