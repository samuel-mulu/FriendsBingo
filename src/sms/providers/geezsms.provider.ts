import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SmsProviderAuthFailedException,
  SmsRateLimitedException,
  SmsUnavailableException,
} from '../sms.errors';

/** Default wait for GeezSMS HTTP response (provider can be slow after accept). */
const DEFAULT_GEEZSMS_TIMEOUT_MS = 30_000;

/** Status strings GeezSMS / gateways commonly return for an accepted send. */
const ACCEPTED_STATUSES = new Set([
  'success',
  'successful',
  'ok',
  'sent',
  'queued',
  'queue',
  'accepted',
  'delivered',
  'submit',
  'submitted',
  'pending',
  'processing',
  '1',
  'true',
]);

/** Explicit failure statuses — never treat these as success. */
const REJECTED_STATUSES = new Set([
  'fail',
  'failed',
  'error',
  'rejected',
  'invalid',
  'denied',
  'unauthorized',
  'forbidden',
  '0',
  'false',
]);

type GeezAcceptReason =
  | 'status'
  | 'http_ok_no_error'
  | 'non_json_http_ok'
  | 'timeout_provisional';

@Injectable()
export class GeezSmsProvider {
  private readonly logger = new Logger(GeezSmsProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    await this.sendSms(
      phone,
      `Your Friends OTP is ${code}. It expires in 5 minutes.`,
    );
  }

  async sendSms(phone: string, msg: string): Promise<void> {
    const token = this.configService.get<string>('GEEZSMS_TOKEN');
    const baseUrl =
      this.configService.get<string>('GEEZSMS_BASE_URL') ??
      'https://api.geezsms.com/api/v1';

    if (!token) {
      throw new SmsProviderAuthFailedException();
    }

    const form = new FormData();
    form.set('token', token);
    form.set('phone', phone);
    form.set('msg', msg);

    const shortcodeId = this.configService.get<string>('GEEZSMS_SHORTCODE_ID');
    if (shortcodeId?.trim()) {
      form.set('shortcode_id', shortcodeId.trim());
    }

    const callbackUrl = this.configService.get<string>('GEEZSMS_CALLBACK_URL');
    if (callbackUrl?.trim()) {
      form.set('callback', callbackUrl.trim());
    }

    const url = `${baseUrl.replace(/\/$/, '')}/sms/send`;
    const timeoutMs = this.getTimeoutMs();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      const isTimeout =
        error instanceof Error &&
        (error.name === 'AbortError' || /aborted/i.test(error.message));

      if (isTimeout) {
        // GeezSMS often queues/delivers before the HTTP response returns.
        // Treat timeout as provisional accept so OTP challenges still get created.
        this.logger.warn(
          `GeezSMS response timed out after ${timeoutMs}ms; treating as provisional accept (SMS may already be delivered)`,
        );
        return;
      }

      this.logger.warn(
        `GeezSMS request failed: ${
          error instanceof Error ? error.message : 'network error'
        }`,
      );
      throw new SmsUnavailableException();
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      throw new SmsProviderAuthFailedException();
    }

    if (response.status === 429) {
      throw new SmsRateLimitedException();
    }

    if (!response.ok) {
      const snippet = await this.safeReadText(response);
      this.logger.warn(
        `GeezSMS HTTP ${response.status}${snippet ? `: ${snippet}` : ''}`,
      );
      throw new SmsUnavailableException();
    }

    const rawText = await this.safeReadText(response);
    let body: unknown = null;

    if (rawText.trim()) {
      try {
        body = JSON.parse(rawText) as unknown;
      } catch {
        // HTTP 2xx with non-JSON body — accept; delivery already likely accepted.
        this.logger.warn(
          `GeezSMS HTTP ${response.status} non-JSON body; treating as accept: ${rawText.slice(0, 200)}`,
        );
        return;
      }
    }

    const decision = this.evaluateGeezResponse(body, response.status);
    if (!decision.accepted) {
      this.logger.warn(
        `GeezSMS rejected send: status=${decision.statusLabel} body=${rawText.slice(0, 300)}`,
      );
      throw new SmsUnavailableException();
    }

    if (decision.reason !== 'status') {
      this.logger.log(
        `GeezSMS accepted send (reason=${decision.reason}, http=${response.status}, status=${decision.statusLabel})`,
      );
    }
  }

  private getTimeoutMs(): number {
    const configured = this.configService.get<number>('GEEZSMS_TIMEOUT_MS');
    if (
      typeof configured === 'number' &&
      Number.isFinite(configured) &&
      configured >= 5_000
    ) {
      return Math.min(Math.floor(configured), 120_000);
    }
    return DEFAULT_GEEZSMS_TIMEOUT_MS;
  }

  private async safeReadText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }

  /**
   * Unified accept/reject rules for GeezSMS (and similar gateway) payloads.
   * Prefer explicit success/failure statuses; otherwise accept clean HTTP 2xx.
   */
  evaluateGeezResponse(
    body: unknown,
    httpStatus: number,
  ): { accepted: boolean; reason: GeezAcceptReason; statusLabel: string } {
    if (body == null) {
      return {
        accepted: httpStatus >= 200 && httpStatus < 300,
        reason: 'http_ok_no_error',
        statusLabel: 'empty',
      };
    }

    if (typeof body !== 'object') {
      const asString = String(body).trim().toLowerCase();
      if (ACCEPTED_STATUSES.has(asString)) {
        return { accepted: true, reason: 'status', statusLabel: asString };
      }
      if (REJECTED_STATUSES.has(asString)) {
        return { accepted: false, reason: 'status', statusLabel: asString };
      }
      return {
        accepted: httpStatus >= 200 && httpStatus < 300,
        reason: 'http_ok_no_error',
        statusLabel: asString || 'unknown',
      };
    }

    const record = body as Record<string, unknown>;
    const statusLabel = this.extractStatusLabel(record);

    if (this.hasExplicitError(record, statusLabel)) {
      return {
        accepted: false,
        reason: 'status',
        statusLabel: statusLabel || 'error',
      };
    }

    if (statusLabel) {
      const normalized = statusLabel.toLowerCase();
      if (ACCEPTED_STATUSES.has(normalized)) {
        return { accepted: true, reason: 'status', statusLabel: normalized };
      }
      if (REJECTED_STATUSES.has(normalized)) {
        return { accepted: false, reason: 'status', statusLabel: normalized };
      }
    }

    // Unknown status text on HTTP 2xx with no error flags → accept (flexible).
    if (httpStatus >= 200 && httpStatus < 300) {
      return {
        accepted: true,
        reason: 'http_ok_no_error',
        statusLabel: statusLabel || 'unknown',
      };
    }

    return {
      accepted: false,
      reason: 'status',
      statusLabel: statusLabel || `http_${httpStatus}`,
    };
  }

  private extractStatusLabel(record: Record<string, unknown>): string | null {
    const candidates: unknown[] = [
      record.message_status,
      record.messageStatus,
      record.status,
      record.Status,
      record.result,
      record.state,
      record.data &&
      typeof record.data === 'object' &&
      record.data !== null
        ? (record.data as Record<string, unknown>).message_status
        : undefined,
      record.data &&
      typeof record.data === 'object' &&
      record.data !== null
        ? (record.data as Record<string, unknown>).status
        : undefined,
    ];

    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
      if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
      }
    }

    return null;
  }

  private hasExplicitError(
    record: Record<string, unknown>,
    statusLabel: string | null,
  ): boolean {
    if (record.error === true || record.Error === true) {
      return true;
    }

    if (typeof record.error === 'string' && record.error.trim()) {
      const lowered = record.error.trim().toLowerCase();
      if (REJECTED_STATUSES.has(lowered) || lowered.includes('fail')) {
        return true;
      }
    }

    const errorCode = record.error_code ?? record.errorCode ?? record.errcode;
    if (
      (typeof errorCode === 'number' && errorCode !== 0) ||
      (typeof errorCode === 'string' &&
        errorCode.trim() !== '' &&
        errorCode.trim() !== '0')
    ) {
      return true;
    }

    if (statusLabel && REJECTED_STATUSES.has(statusLabel.toLowerCase())) {
      return true;
    }

    return false;
  }
}
