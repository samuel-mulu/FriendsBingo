import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SmsProviderAuthFailedException,
  SmsRateLimitedException,
  SmsUnavailableException,
} from '../sms.errors';

/** Default wait for GeezSMS HTTP response (provider can be slow after accept). */
const DEFAULT_GEEZSMS_TIMEOUT_MS = 30_000;

/** GeezSMS OTP codes are 4 digits. */
export const GEEZSMS_OTP_LENGTH = 4;

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
  'sms_sent_succssfully',
  'sms_sent_successfully',
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
  | 'otp_success';

@Injectable()
export class GeezSmsProvider {
  private readonly logger = new Logger(GeezSmsProvider.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Send OTP via GeezSMS dedicated OTP endpoint.
   * Uses GET + query params (same shape that delivers reliably in Postman).
   * Geez generates the code; we return it so the backend can hash/verify locally.
   */
  async sendOtp(phone: string): Promise<string> {
    const token = this.configService.get<string>('GEEZSMS_TOKEN');
    const baseUrl =
      this.configService.get<string>('GEEZSMS_BASE_URL') ??
      'https://api.geezsms.com/api/v1';

    if (!token) {
      throw new SmsProviderAuthFailedException();
    }

    const params = new URLSearchParams();
    params.set('token', token);
    params.set('phone', phone);

    const shortcodeId = this.resolveShortcodeId();
    if (shortcodeId) {
      params.set('shortcode_id', shortcodeId);
    }

    const url = `${baseUrl.replace(/\/$/, '')}/sms/otp?${params.toString()}`;
    this.logger.log(
      `GeezSMS OTP request phone=${this.maskPhone(phone)} shortcode=${shortcodeId ?? 'default'}`,
    );

    const body = await this.getJson(url);
    const decision = this.evaluateGeezResponse(body, 200);

    if (!decision.accepted) {
      this.logger.warn(
        `GeezSMS OTP rejected: status=${decision.statusLabel} body=${JSON.stringify(body).slice(0, 300)}`,
      );
      throw new SmsUnavailableException();
    }

    const otp = this.extractOtpCode(body);
    if (!otp) {
      this.logger.warn(
        `GeezSMS OTP accepted but no ${GEEZSMS_OTP_LENGTH}-digit code in response: ${JSON.stringify(body).slice(0, 300)}`,
      );
      throw new SmsUnavailableException();
    }

    this.logger.log(
      `GeezSMS OTP accepted phone=${this.maskPhone(phone)} reason=${decision.reason} api_log_id=${this.extractApiLogId(body) ?? 'n/a'}`,
    );

    return otp;
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

    const shortcodeId = this.resolveShortcodeId();
    if (shortcodeId) {
      form.set('shortcode_id', shortcodeId);
    }

    const callbackUrl = this.configService.get<string>('GEEZSMS_CALLBACK_URL');
    if (callbackUrl?.trim()) {
      form.set('callback', callbackUrl.trim());
    }

    const url = `${baseUrl.replace(/\/$/, '')}/sms/send`;
    const body = await this.postForm(url, form, { allowTimeoutProvisional: true });
    const decision = this.evaluateGeezResponse(body, 200);

    if (!decision.accepted) {
      this.logger.warn(
        `GeezSMS rejected send: status=${decision.statusLabel} body=${JSON.stringify(body).slice(0, 300)}`,
      );
      throw new SmsUnavailableException();
    }

    if (decision.reason !== 'status' && decision.reason !== 'otp_success') {
      this.logger.log(
        `GeezSMS accepted send (reason=${decision.reason}, status=${decision.statusLabel})`,
      );
    }
  }

  /**
   * Extract Geez-generated OTP from /sms/otp response.
   * Observed shape: { error: false, code: 6678, data: { code: 6678, ... } }
   */
  extractOtpCode(body: unknown): string | null {
    if (body == null || typeof body !== 'object') {
      return null;
    }

    const record = body as Record<string, unknown>;
    const data =
      record.data && typeof record.data === 'object' && record.data !== null
        ? (record.data as Record<string, unknown>)
        : null;

    const candidates: unknown[] = [
      record.otp,
      record.pin,
      record.code,
      data?.otp,
      data?.pin,
      data?.code,
    ];

    for (const value of candidates) {
      const normalized = this.normalizeOtpCandidate(value);
      if (normalized) {
        return normalized;
      }
    }

    return null;
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

    // Geez OTP / send success: { error: false, msg: "SMS has been sent successfully." }
    if (record.error === false) {
      const msg = typeof record.msg === 'string' ? record.msg.toLowerCase() : '';
      const dataMsg =
        record.data &&
        typeof record.data === 'object' &&
        record.data !== null &&
        typeof (record.data as Record<string, unknown>).msg === 'string'
          ? String((record.data as Record<string, unknown>).msg).toLowerCase()
          : '';

      if (
        msg.includes('sent successfully') ||
        dataMsg.includes('sms_sent') ||
        ACCEPTED_STATUSES.has(dataMsg)
      ) {
        return {
          accepted: true,
          reason: 'otp_success',
          statusLabel: 'sent_successfully',
        };
      }

      if (httpStatus >= 200 && httpStatus < 300) {
        return {
          accepted: true,
          reason: 'otp_success',
          statusLabel: 'error_false',
        };
      }
    }

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

  /** Only send a real shortcode; ignore empty / placeholder env values. */
  private resolveShortcodeId(): string | null {
    const raw = this.configService.get<string>('GEEZSMS_SHORTCODE_ID')?.trim();
    if (!raw) {
      return null;
    }
    if (/^your[\s_-]*shortcode/i.test(raw) || raw.toLowerCase() === 'optional') {
      this.logger.warn(
        `Ignoring invalid GEEZSMS_SHORTCODE_ID placeholder value: ${raw}`,
      );
      return null;
    }
    return raw;
  }

  private maskPhone(phone: string): string {
    if (phone.length <= 7) {
      return phone;
    }
    return `${phone.slice(0, 7)}${'*'.repeat(phone.length - 7)}`;
  }

  private async getJson(url: string): Promise<unknown> {
    const timeoutMs = this.getTimeoutMs();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
    } catch (error) {
      this.logger.warn(
        `GeezSMS OTP GET failed: ${
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
        `GeezSMS OTP HTTP ${response.status}${snippet ? `: ${snippet}` : ''}`,
      );
      throw new SmsUnavailableException();
    }

    const rawText = await this.safeReadText(response);
    if (!rawText.trim()) {
      throw new SmsUnavailableException();
    }

    try {
      return JSON.parse(rawText) as unknown;
    } catch {
      this.logger.warn(
        `GeezSMS OTP non-JSON body: ${rawText.slice(0, 200)}`,
      );
      throw new SmsUnavailableException();
    }
  }

  private async postForm(
    url: string,
    form: FormData,
    options?: { allowTimeoutProvisional?: boolean },
  ): Promise<unknown> {
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

      if (isTimeout && options?.allowTimeoutProvisional) {
        // Generic SMS: Geez often queues before HTTP returns.
        this.logger.warn(
          `GeezSMS response timed out after ${timeoutMs}ms; treating as provisional accept (SMS may already be delivered)`,
        );
        return null;
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
    if (!rawText.trim()) {
      return null;
    }

    try {
      return JSON.parse(rawText) as unknown;
    } catch {
      this.logger.warn(
        `GeezSMS HTTP ${response.status} non-JSON body: ${rawText.slice(0, 200)}`,
      );
      if (options?.allowTimeoutProvisional) {
        return null;
      }
      throw new SmsUnavailableException();
    }
  }

  private normalizeOtpCandidate(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const asInt = Math.trunc(value);
      if (asInt < 0) {
        return null;
      }
      const padded = String(asInt).padStart(GEEZSMS_OTP_LENGTH, '0');
      if (padded.length === GEEZSMS_OTP_LENGTH && /^\d+$/.test(padded)) {
        return padded;
      }
      return null;
    }

    if (typeof value === 'string') {
      const digits = value.trim();
      if (new RegExp(`^\\d{${GEEZSMS_OTP_LENGTH}}$`).test(digits)) {
        return digits;
      }
    }

    return null;
  }

  private extractApiLogId(body: unknown): string | number | null {
    if (body == null || typeof body !== 'object') {
      return null;
    }
    const record = body as Record<string, unknown>;
    if (
      typeof record.api_log_id === 'number' ||
      typeof record.api_log_id === 'string'
    ) {
      return record.api_log_id;
    }
    if (record.data && typeof record.data === 'object' && record.data !== null) {
      const data = record.data as Record<string, unknown>;
      if (
        typeof data.api_log_id === 'number' ||
        typeof data.api_log_id === 'string'
      ) {
        return data.api_log_id;
      }
    }
    return null;
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

  private extractStatusLabel(record: Record<string, unknown>): string | null {
    const candidates: unknown[] = [
      record.message_status,
      record.messageStatus,
      record.status,
      record.Status,
      record.result,
      record.state,
      typeof record.msg === 'string' ? record.msg : undefined,
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
      record.data &&
      typeof record.data === 'object' &&
      record.data !== null
        ? (record.data as Record<string, unknown>).msg
        : undefined,
    ];

    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
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
