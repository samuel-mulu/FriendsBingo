import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { DepositVerificationProvider } from '../interfaces/deposit-verification-provider.interface';
import { DepositVerificationResult } from '../types/deposit-verification-result.type';
import { VerifyDepositInput } from '../types/verify-deposit-input.type';

interface VerifyEtVerificationRecord {
  verified?: boolean;
  status?: string;
  processingStatus?: string;
  errorMessage?: string;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
  };
  amount?: string | number;
  currency?: string;
  payerName?: string;
  payerAccount?: string;
  receiverName?: string;
  receiverAccount?: string;
  settlementAccount?: string;
  settlementAccountMatch?: {
    matched?: boolean;
    submitted?: string;
    extracted?: string;
  };
  paidAt?: string;
  transactionNumber?: string;
  referenceNumber?: string;
  reference?: string;
}

interface VerifyEtVerificationMeta {
  processingStatus?: string;
  verified?: boolean;
}

type VerifyEtRawBody = Record<string, unknown>;

interface VerifyEtHttpResponse {
  httpStatus: number;
  body: VerifyEtRawBody;
}

interface NormalizedVerifyEtResponse {
  requestId?: string;
  processingStatus?: string;
  status?: string;
  verified?: boolean;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  record?: VerifyEtVerificationRecord;
}

export abstract class VerifyEtBaseVerifier
  implements DepositVerificationProvider
{
  abstract readonly provider: PaymentProvider;
  protected readonly logger: Logger;

  constructor(protected readonly configService: ConfigService) {
    this.logger = new Logger(this.constructor.name);
  }

  async verify(input: VerifyDepositInput): Promise<DepositVerificationResult> {
    const baseUrl = this.getRequiredConfig('VERIFY_ET_BASE_URL').replace(
      /\/+$/,
      '',
    );
    const waitMs = Number(this.getRequiredConfig('VERIFY_ET_WAIT_MS'));
    const pollAttempts = Number(
      this.getRequiredConfig('VERIFY_ET_POLL_ATTEMPTS'),
    );
    const pollIntervalMs = Number(
      this.getRequiredConfig('VERIFY_ET_POLL_INTERVAL_MS'),
    );
    const apiKey = this.getRequiredConfig('VERIFY_ET_API_KEY');
    const requestBody = this.buildRequestBody(input);

    let submitHttpResponse: VerifyEtHttpResponse;

    try {
      const response = await fetch(`${baseUrl}/api/verify?waitMs=${waitMs}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'Idempotency-Key': this.buildIdempotencyKey(input, requestBody),
        },
        body: JSON.stringify(requestBody),
      });

      submitHttpResponse = await this.parseHttpResponse(response);
      this.logSubmitResponse(submitHttpResponse);
    } catch (error) {
      this.logger.warn(
        `[Verify.ET submit] request failed provider=${this.provider} transactionRef=${input.transactionRef} error=${error instanceof Error ? error.message : String(error)}`,
      );
      return this.buildUnavailableResult(input.transactionRef);
    }

    const submitNormalized = this.normalizeVerifyEtResponse(
      submitHttpResponse.body,
    );
    const requestId = submitNormalized.requestId;
    let finalHttpResponse = submitHttpResponse;

    const shouldPoll =
      Boolean(requestId) &&
      (submitHttpResponse.httpStatus === 202 ||
        !this.isTerminal(submitNormalized));

    if (shouldPoll && requestId) {
      finalHttpResponse = await this.pollForCompletion(
        baseUrl,
        apiKey,
        requestId,
        pollAttempts,
        pollIntervalMs,
        submitHttpResponse,
      );
    }

    return this.mapVerificationResult({
      input,
      requestBody,
      requestId,
      submitHttpResponse,
      finalHttpResponse,
    });
  }

  protected abstract buildRequestBody(
    input: VerifyDepositInput,
  ): Record<string, string>;

  protected buildIdempotencyKey(
    input: VerifyDepositInput,
    requestBody: Record<string, string>,
  ): string {
    const payloadFingerprint = createHash('sha256')
      .update(this.stableStringify(requestBody))
      .digest('hex')
      .slice(0, 16);

    return `deposit-${this.provider.toLowerCase()}-${input.transactionRef}-${payloadFingerprint}`;
  }

  protected buildInvalidReceiptReason(): string {
    return 'Receipt could not be verified. Check the receipt code.';
  }

  protected buildReceiverMismatchReason(): string {
    return 'This receipt was not paid to Friends Bingo.';
  }

  protected isReceiverMismatch(
    _record: VerifyEtVerificationRecord | undefined,
  ): boolean {
    return false;
  }

  protected getRecordTransactionRef(
    record: VerifyEtVerificationRecord | undefined,
    fallback: string,
  ): string {
    return (
      record?.transactionNumber?.trim() ||
      record?.referenceNumber?.trim() ||
      record?.reference?.trim() ||
      fallback
    );
  }

  private async pollForCompletion(
    baseUrl: string,
    apiKey: string,
    requestId: string,
    pollAttempts: number,
    pollIntervalMs: number,
    submitHttpResponse: VerifyEtHttpResponse,
  ): Promise<VerifyEtHttpResponse> {
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      await this.sleep(pollIntervalMs);

      try {
        const response = await fetch(`${baseUrl}/api/verify/${requestId}`, {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
          },
        });

        const pollHttpResponse = await this.parseHttpResponse(response);
        this.logPollResponse(pollHttpResponse, attempt + 1);

        const normalized = this.normalizeVerifyEtResponse(pollHttpResponse.body);
        if (this.isTerminal(normalized)) {
          return pollHttpResponse;
        }
      } catch (error) {
        this.logger.warn(
          `[Verify.ET poll] request failed provider=${this.provider} requestId=${requestId} attempt=${attempt + 1} error=${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          httpStatus: 500,
          body: {
            requestId,
            processingStatus: 'error',
            verified: false,
            reason: 'Verify.ET polling failed',
          },
        };
      }
    }

    this.logger.warn(
      `[Verify.ET poll] timed out provider=${this.provider} requestId=${requestId} attempts=${pollAttempts}`,
    );

    return {
      httpStatus: 504,
      body: {
        requestId,
        processingStatus: 'pending',
        verified: false,
        reason: 'Verify.ET verification did not complete in time',
        submitResponse: submitHttpResponse.body,
      },
    };
  }

  private async parseHttpResponse(
    response: Response,
  ): Promise<VerifyEtHttpResponse> {
    const text = await response.text();
    let body: VerifyEtRawBody = {};

    if (text) {
      body = JSON.parse(text) as VerifyEtRawBody;
    }

    if (response.ok || response.status === 202) {
      return { httpStatus: response.status, body };
    }

    throw new Error(
      this.pickString(body.message) ??
        this.pickString(body.reason) ??
        `Verify.ET request failed with status ${response.status}`,
    );
  }

  private mapVerificationResult(params: {
    input: VerifyDepositInput;
    requestBody: Record<string, string>;
    requestId?: string;
    submitHttpResponse: VerifyEtHttpResponse;
    finalHttpResponse: VerifyEtHttpResponse;
  }): DepositVerificationResult {
    const { input, requestBody, requestId, submitHttpResponse, finalHttpResponse } =
      params;

    const submitNormalized = this.normalizeVerifyEtResponse(
      submitHttpResponse.body,
    );
    const finalNormalized = this.normalizeVerifyEtResponse(
      finalHttpResponse.body,
    );
    const record = this.mergeVerificationRecords(
      submitNormalized.record,
      finalNormalized.record,
    );
    const processingStatus =
      finalNormalized.processingStatus ?? submitNormalized.processingStatus;
    const verified =
      finalNormalized.verified === true || submitNormalized.verified === true;

    const raw = {
      source: 'verify.et',
      requestId,
      request: requestBody,
      submitResponse: submitHttpResponse.body,
      submitHttpStatus: submitHttpResponse.httpStatus,
      finalResponse: finalHttpResponse.body,
      finalHttpStatus: finalHttpResponse.httpStatus,
    };

    if (!this.isCompletedStatus(processingStatus)) {
      return {
        verified: false,
        status: 'ERROR',
        code: 'VERIFICATION_UNAVAILABLE',
        provider: this.provider,
        transactionRef: input.transactionRef,
        requestId,
        verificationSource: 'verify.et',
        raw,
        reason:
          'Payment verification is temporarily unavailable. Please try again.',
      };
    }

    const recordVerified = record?.verified !== false;
    const recordStatus = record?.status?.trim().toLowerCase();
    const recordSuccess =
      recordStatus === undefined ||
      recordStatus === 'success' ||
      recordStatus === 'completed';

    if (!verified || !record || !recordVerified || !recordSuccess) {
      return this.buildInvalidReceiptResult(input, record, raw, requestId);
    }

    const normalizedCurrency = record.currency?.trim().toUpperCase();
    if (normalizedCurrency && normalizedCurrency !== 'ETB') {
      return this.buildInvalidReceiptResult(input, record, raw, requestId);
    }

    const providerAmount = this.toOptionalString(record.amount);
    if (
      providerAmount &&
      !this.amountMatches(providerAmount, input.requestedAmount)
    ) {
      return {
        verified: false,
        status: 'INVALID',
        code: 'AMOUNT_MISMATCH',
        provider: this.provider,
        transactionRef: this.getRecordTransactionRef(record, input.transactionRef),
        amount: providerAmount,
        currency: record.currency,
        payerName: record.payerName,
        payerAccount: record.payerAccount,
        receiverName: record.receiverName,
        receiverAccount: record.receiverAccount ?? record.settlementAccount,
        paidAt: this.parseDate(record.paidAt),
        requestId,
        verificationSource: 'verify.et',
        raw,
        reason:
          'Amount does not match this receipt. Please enter the correct amount.',
      };
    }

    if (this.isReceiverMismatch(record)) {
      return {
        verified: false,
        status: 'INVALID',
        code: 'RECEIVER_MISMATCH',
        provider: this.provider,
        transactionRef: this.getRecordTransactionRef(record, input.transactionRef),
        amount: providerAmount,
        currency: record.currency,
        payerName: record.payerName,
        payerAccount: record.payerAccount,
        receiverName: record.receiverName,
        receiverAccount: record.receiverAccount ?? record.settlementAccount,
        paidAt: this.parseDate(record.paidAt),
        requestId,
        verificationSource: 'verify.et',
        raw,
        reason: this.buildReceiverMismatchReason(),
      };
    }

    return {
      verified: true,
      status: 'VERIFIED',
      code: 'APPROVED',
      provider: this.provider,
      transactionRef: this.getRecordTransactionRef(record, input.transactionRef),
      amount: providerAmount,
      currency: record.currency,
      payerName: record.payerName,
      payerAccount: record.payerAccount,
      receiverName: record.receiverName,
      receiverAccount: record.receiverAccount ?? record.settlementAccount,
      paidAt: this.parseDate(record.paidAt),
      requestId,
      verificationSource: 'verify.et',
      raw,
      reason: 'Deposit successful. Wallet updated.',
    };
  }

  private buildInvalidReceiptResult(
    input: VerifyDepositInput,
    record: VerifyEtVerificationRecord | undefined,
    raw: Record<string, unknown>,
    requestId?: string,
  ): DepositVerificationResult {
    return {
      verified: false,
      status: 'INVALID',
      code: 'INVALID_RECEIPT',
      provider: this.provider,
      transactionRef: this.getRecordTransactionRef(record, input.transactionRef),
      amount: this.toOptionalString(record?.amount),
      currency: record?.currency,
      payerName: record?.payerName,
      payerAccount: record?.payerAccount,
      receiverName: record?.receiverName,
      receiverAccount: record?.receiverAccount ?? record?.settlementAccount,
      paidAt: this.parseDate(record?.paidAt),
      requestId,
      verificationSource: 'verify.et',
      raw,
      reason: this.buildInvalidReceiptReason(),
    };
  }

  private normalizeVerifyEtResponse(
    body: VerifyEtRawBody,
  ): NormalizedVerifyEtResponse {
    const verification = this.asObject(body.verification) as
      | VerifyEtVerificationMeta
      | undefined;
    const data = body.data;
    const arrayRecord = Array.isArray(data)
      ? (data[0] as VerifyEtVerificationRecord | undefined)
      : undefined;
    const objectRecord = this.isVerificationRecord(data) ? data : undefined;
    const record = arrayRecord ?? objectRecord;

    const processingStatus =
      this.pickString(body.processingStatus) ??
      this.pickString(verification?.processingStatus) ??
      this.pickString(objectRecord?.processingStatus);
    const status =
      this.pickString(body.status) ?? this.pickString(objectRecord?.status);
    const objectError = this.asObject(objectRecord?.error);
    const bodyError = this.asObject(body.error);
    const errorCode =
      this.pickString(bodyError?.code) ?? this.pickString(objectError?.code);
    const errorMessage =
      this.pickString(body.errorMessage) ??
      this.pickString(body.message) ??
      this.pickString(objectRecord?.errorMessage) ??
      this.pickString(bodyError?.message) ??
      this.pickString(objectError?.message);
    const retryable =
      bodyError?.retryable === true || objectError?.retryable === true;

    const verified =
      body.verified === true ||
      verification?.verified === true ||
      objectRecord?.verified === true ||
      arrayRecord?.verified === true
        ? true
        : body.verified === false ||
            verification?.verified === false ||
            objectRecord?.verified === false ||
            arrayRecord?.verified === false
          ? false
          : undefined;

    return {
      requestId: this.pickString(body.requestId),
      processingStatus,
      status,
      verified,
      errorCode,
      errorMessage,
      retryable,
      record,
    };
  }

  private mergeVerificationRecords(
    submitRecord?: VerifyEtVerificationRecord,
    finalRecord?: VerifyEtVerificationRecord,
  ): VerifyEtVerificationRecord | undefined {
    if (!submitRecord && !finalRecord) {
      return undefined;
    }

    if (!submitRecord) {
      return finalRecord;
    }

    if (!finalRecord) {
      return submitRecord;
    }

    return {
      ...submitRecord,
      ...finalRecord,
      amount: finalRecord.amount ?? submitRecord.amount,
      currency: finalRecord.currency ?? submitRecord.currency,
      settlementAccount:
        finalRecord.settlementAccount ?? submitRecord.settlementAccount,
      settlementAccountMatch:
        finalRecord.settlementAccountMatch ??
        submitRecord.settlementAccountMatch,
      payerName: finalRecord.payerName ?? submitRecord.payerName,
      payerAccount: finalRecord.payerAccount ?? submitRecord.payerAccount,
      receiverName: finalRecord.receiverName ?? submitRecord.receiverName,
      receiverAccount:
        finalRecord.receiverAccount ?? submitRecord.receiverAccount,
      paidAt: finalRecord.paidAt ?? submitRecord.paidAt,
      transactionNumber:
        finalRecord.transactionNumber ?? submitRecord.transactionNumber,
      referenceNumber:
        finalRecord.referenceNumber ?? submitRecord.referenceNumber,
      reference: finalRecord.reference ?? submitRecord.reference,
      verified:
        finalRecord.verified === false || submitRecord.verified === false
          ? false
          : (finalRecord.verified ?? submitRecord.verified),
      status: finalRecord.status ?? submitRecord.status,
    };
  }

  private logSubmitResponse(response: VerifyEtHttpResponse): void {
    const normalized = this.normalizeVerifyEtResponse(response.body);
    const verification = this.asObject(response.body.verification);
    const data = response.body.data;
    const dataFirst = Array.isArray(data) ? data[0] : undefined;

    this.logger.log(
      `[Verify.ET submit] provider=${this.provider} HTTP ${response.httpStatus} body=${JSON.stringify(response.body)}`,
    );
    this.logger.log(
      `[Verify.ET submit] provider=${this.provider} requestId=${normalized.requestId ?? 'none'} verification.processingStatus=${this.pickString(verification?.processingStatus) ?? 'none'} verification.verified=${verification?.verified ?? 'none'} processingStatus=${normalized.processingStatus ?? 'none'} verified=${normalized.verified ?? 'none'} data[0]=${dataFirst ? JSON.stringify(dataFirst) : 'none'}`,
    );
  }

  private logPollResponse(
    response: VerifyEtHttpResponse,
    attempt: number,
  ): void {
    const data = response.body.data;
    const statusData = this.isVerificationRecord(data) ? data : undefined;

    this.logger.log(
      `[Verify.ET poll] provider=${this.provider} attempt=${attempt} HTTP ${response.httpStatus} body=${JSON.stringify(response.body)}`,
    );
    this.logger.log(
      `[Verify.ET poll] provider=${this.provider} attempt=${attempt} data.processingStatus=${statusData?.processingStatus ?? 'none'} data.status=${statusData?.status ?? 'none'} data.verified=${statusData?.verified ?? 'none'}`,
    );
  }

  private isTerminal(normalized: NormalizedVerifyEtResponse): boolean {
    return (
      this.isCompletedStatus(normalized.processingStatus) ||
      this.isUnavailableStatus(normalized.processingStatus)
    );
  }

  private isCompletedStatus(processingStatus?: string): boolean {
    return processingStatus?.trim().toLowerCase() === 'completed';
  }

  private isUnavailableStatus(processingStatus?: string): boolean {
    const normalized = processingStatus?.trim().toLowerCase();
    return normalized === 'failed' || normalized === 'error';
  }

  private isVerificationRecord(
    value: unknown,
  ): value is VerifyEtVerificationRecord {
    if (!this.asObject(value)) {
      return false;
    }

    const record = value as VerifyEtVerificationRecord;
    return (
      record.verified !== undefined ||
      record.status !== undefined ||
      record.processingStatus !== undefined ||
      record.amount !== undefined ||
      record.settlementAccountMatch !== undefined ||
      record.transactionNumber !== undefined ||
      record.referenceNumber !== undefined ||
      record.reference !== undefined
    );
  }

  private asObject(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }

    return value as Record<string, unknown>;
  }

  private pickString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private buildUnavailableResult(
    transactionRef: string,
  ): DepositVerificationResult {
    return {
      verified: false,
      status: 'ERROR',
      code: 'VERIFICATION_UNAVAILABLE',
      provider: this.provider,
      transactionRef,
      verificationSource: 'verify.et',
      reason:
        'Payment verification is temporarily unavailable. Please try again.',
    };
  }

  private parseDate(value?: string): Date | undefined {
    return value ? new Date(value) : undefined;
  }

  private stableStringify(value: Record<string, string>): string {
    return JSON.stringify(
      Object.keys(value)
        .sort()
        .reduce<Record<string, string>>((acc, key) => {
          acc[key] = value[key];
          return acc;
        }, {}),
    );
  }

  private amountMatches(
    providerAmount: string,
    requestedAmount: string,
  ): boolean {
    try {
      return new Prisma.Decimal(providerAmount).equals(
        new Prisma.Decimal(requestedAmount),
      );
    } catch {
      return false;
    }
  }

  private toOptionalString(value?: string | number): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return String(value);
  }

  protected getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`${key} is not configured`);
    }

    return value;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
