import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  VERIFY_ET_COMPLETED_STATUS,
  VERIFY_ET_UNAVAILABLE_STATUSES,
} from './verify-et.constants';

export interface VerifyEtVerificationRecord {
  verified?: boolean;
  status?: string;
  processingStatus?: string;
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

export interface VerifyEtClientResult {
  requestId?: string;
  processingStatus?: string;
  verified: boolean;
  record?: VerifyEtVerificationRecord;
  rawResponse: Record<string, unknown>;
  unavailable: boolean;
}

type VerifyEtRawBody = Record<string, unknown>;

interface VerifyEtHttpResponse {
  httpStatus: number;
  body: VerifyEtRawBody;
}

interface NormalizedVerifyEtResponse {
  requestId?: string;
  processingStatus?: string;
  verified?: boolean;
  record?: VerifyEtVerificationRecord;
}

@Injectable()
export class VerifyEtClient {
  private readonly logger = new Logger(VerifyEtClient.name);

  constructor(private readonly configService: ConfigService) {}

  async submitAndPoll(
    requestBody: Record<string, string>,
    idempotencySeed: string,
  ): Promise<VerifyEtClientResult> {
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

    let submitHttpResponse: VerifyEtHttpResponse;

    try {
      const response = await fetch(`${baseUrl}/api/verify?waitMs=${waitMs}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'Idempotency-Key': this.buildIdempotencyKey(
            idempotencySeed,
            requestBody,
          ),
        },
        body: JSON.stringify(requestBody),
      });

      submitHttpResponse = await this.parseHttpResponse(response);
    } catch (error) {
      this.logger.warn(
        `[Verify.ET submit] request failed error=${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        verified: false,
        unavailable: true,
        rawResponse: { error: 'submit_failed' },
      };
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
      );
    }

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

    const rawResponse = {
      requestId,
      request: requestBody,
      submitResponse: submitHttpResponse.body,
      submitHttpStatus: submitHttpResponse.httpStatus,
      finalResponse: finalHttpResponse.body,
      finalHttpStatus: finalHttpResponse.httpStatus,
    };

    if (!this.isCompletedStatus(processingStatus)) {
      return {
        requestId,
        processingStatus,
        verified: false,
        record,
        rawResponse,
        unavailable: true,
      };
    }

    return {
      requestId,
      processingStatus,
      verified,
      record,
      rawResponse,
      unavailable: false,
    };
  }

  private async pollForCompletion(
    baseUrl: string,
    apiKey: string,
    requestId: string,
    pollAttempts: number,
    pollIntervalMs: number,
  ): Promise<VerifyEtHttpResponse> {
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      await this.sleep(pollIntervalMs);

      try {
        const response = await fetch(`${baseUrl}/api/verify/${requestId}`, {
          method: 'GET',
          headers: { 'x-api-key': apiKey },
        });

        const pollHttpResponse = await this.parseHttpResponse(response);
        const normalized = this.normalizeVerifyEtResponse(
          pollHttpResponse.body,
        );
        if (this.isTerminal(normalized)) {
          return pollHttpResponse;
        }
      } catch (error) {
        this.logger.warn(
          `[Verify.ET poll] failed requestId=${requestId} attempt=${attempt + 1}`,
        );
        return {
          httpStatus: 500,
          body: {
            requestId,
            processingStatus: 'error',
            verified: false,
          },
        };
      }
    }

    return {
      httpStatus: 504,
      body: {
        requestId,
        processingStatus: 'pending',
        verified: false,
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

  private normalizeVerifyEtResponse(
    body: VerifyEtRawBody,
  ): NormalizedVerifyEtResponse {
    const verification = this.asObject(body.verification);
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
      verified,
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
      settlementAccountMatch:
        finalRecord.settlementAccountMatch ??
        submitRecord.settlementAccountMatch,
      receiverName: finalRecord.receiverName ?? submitRecord.receiverName,
      verified:
        finalRecord.verified === false || submitRecord.verified === false
          ? false
          : (finalRecord.verified ?? submitRecord.verified),
      status: finalRecord.status ?? submitRecord.status,
    };
  }

  private isTerminal(normalized: NormalizedVerifyEtResponse): boolean {
    return (
      this.isCompletedStatus(normalized.processingStatus) ||
      VERIFY_ET_UNAVAILABLE_STATUSES.has(
        normalized.processingStatus?.trim().toLowerCase() ?? '',
      )
    );
  }

  private isCompletedStatus(processingStatus?: string): boolean {
    return (
      processingStatus?.trim().toLowerCase() === VERIFY_ET_COMPLETED_STATUS
    );
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
      record.amount !== undefined ||
      record.settlementAccountMatch !== undefined ||
      record.transactionNumber !== undefined ||
      record.referenceNumber !== undefined
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

  private buildIdempotencyKey(
    seed: string,
    requestBody: Record<string, string>,
  ): string {
    const payloadFingerprint = createHash('sha256')
      .update(this.stableStringify(requestBody))
      .digest('hex')
      .slice(0, 16);

    return `deposit-${seed}-${payloadFingerprint}`;
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

  private getRequiredConfig(key: string): string {
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
