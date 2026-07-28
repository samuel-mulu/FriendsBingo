import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'http';
import * as https from 'https';
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
    const body = await this.postForm(url, form, {
      allowTimeoutProvisional: true,
    });
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
   * Fetch account balance from GeezSMS.
   * Uses GET with token query + X-GeezSMS-Key (same credentials as OTP).
   * Multipart GET bodies are rejected by Geez from Node; query auth works.
   */
  async getBalance(): Promise<{ balance: string; currency: string | null }> {
    const token = this.configService.get<string>('GEEZSMS_TOKEN');
    if (!token) {
      throw new SmsProviderAuthFailedException();
    }

    const baseUrl =
      this.configService.get<string>('GEEZSMS_BASE_URL') ??
      'https://api.geezsms.com/api/v1';
    const configuredApiKey =
      this.configService.get<string>('GEEZSMS_API_KEY')?.trim() || '';
    const apiKey = configuredApiKey || token;
    const billingId =
      this.configService.get<string>('GEEZSMS_BILLING_ID')?.trim() || '';

    const params = new URLSearchParams();
    params.set('token', token);
    if (billingId) {
      params.set('billing_id', billingId);
    }

    const endpoint = `${baseUrl.replace(/\/$/, '')}/balance`;
    const url = new URL(`${endpoint}?${params.toString()}`);
    this.logger.log('GeezSMS balance request');

    const result = await this.requestRaw({
      url,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-GeezSMS-Key': apiKey,
      },
    });

    this.logger.log(
      `GeezSMS balance: HTTP ${result.status} ${this.summarizeBody(result.body, result.raw)}`,
    );

    if (result.status === 401 || result.status === 403) {
      throw new SmsProviderAuthFailedException(
        'GeezSMS authentication failed. Check GEEZSMS_TOKEN (and GEEZSMS_API_KEY if you use a separate key).',
      );
    }

    if (result.status === 429) {
      throw new SmsRateLimitedException();
    }

    if (result.status < 200 || result.status >= 300) {
      throw new SmsUnavailableException(
        `GeezSMS balance unavailable (HTTP ${result.status})`,
      );
    }

    // Geez may return error:true in a 200 body.
    if (
      result.body != null &&
      typeof result.body === 'object' &&
      (result.body as Record<string, unknown>).error === true
    ) {
      const msg = (result.body as Record<string, unknown>).msg;
      throw new SmsProviderAuthFailedException(
        typeof msg === 'string' && msg.trim()
          ? msg.trim()
          : 'GeezSMS authentication failed. Check GEEZSMS_TOKEN / GEEZSMS_API_KEY.',
      );
    }

    const extracted = this.extractBalanceResult(result.body);
    if (extracted == null) {
      throw new SmsUnavailableException(
        `GeezSMS balance unavailable (no balance in ${this.summarizeBody(result.body, result.raw)})`,
      );
    }

    return extracted;
  }

  private async requestRaw(options: {
    url: URL;
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: Buffer;
  }): Promise<{ status: number; body: unknown; raw: string }> {
    const timeoutMs = this.getTimeoutMs();
    const transport = options.url.protocol === 'http:' ? http : https;

    return new Promise((resolve, reject) => {
      const request = transport.request(
        {
          protocol: options.url.protocol,
          hostname: options.url.hostname,
          port: options.url.port || undefined,
          path: `${options.url.pathname}${options.url.search}`,
          method: options.method,
          headers: options.headers,
          timeout: timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let parsed: unknown = null;
            if (raw.trim()) {
              try {
                parsed = JSON.parse(raw) as unknown;
              } catch {
                parsed = raw;
              }
            }

            resolve({
              status: response.statusCode ?? 0,
              body: parsed,
              raw,
            });
          });
        },
      );

      request.on('timeout', () => {
        request.destroy(new Error(`timed out after ${timeoutMs}ms`));
      });
      request.on('error', (error) => {
        reject(error);
      });

      if (options.body) {
        request.write(options.body);
      }
      request.end();
    });
  }

  private summarizeBody(body: unknown, raw: string): string {
    if (body != null && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      const keys = Object.keys(record).slice(0, 10);
      const preview = JSON.stringify(body).slice(0, 180);
      return `keys=[${keys.join(',')}] body=${preview}`;
    }
    return raw.slice(0, 180) || 'empty body';
  }

  extractBalanceResult(
    body: unknown,
  ): { balance: string; currency: string | null } | null {
    const balance = this.extractBalance(body);
    if (balance == null) {
      return null;
    }

    const currency = this.extractCurrency(body);
    if (currency) {
      return { balance, currency };
    }

    // Geez often returns remaining SMS credits as total_sms.
    if (
      body != null &&
      typeof body === 'object' &&
      (body as Record<string, unknown>).data &&
      typeof (body as Record<string, unknown>).data === 'object' &&
      (body as { data: Record<string, unknown> }).data.total_sms != null
    ) {
      return { balance, currency: 'SMS' };
    }

    return { balance, currency: null };
  }

  extractBalance(body: unknown): string | null {
    if (typeof body === 'number' && Number.isFinite(body)) {
      return String(body);
    }

    if (typeof body === 'string' && body.trim() !== '') {
      const normalized = body.trim().replace(/,/g, '');
      if (!Number.isNaN(Number(normalized))) {
        return normalized;
      }
    }

    if (body == null || typeof body !== 'object') {
      return null;
    }

    const record = body as Record<string, unknown>;
    const nestedObjects: Array<Record<string, unknown> | null> = [
      record,
      record.data && typeof record.data === 'object' && record.data !== null
        ? (record.data as Record<string, unknown>)
        : null,
      record.balance &&
      typeof record.balance === 'object' &&
      record.balance !== null
        ? (record.balance as Record<string, unknown>)
        : null,
      record.result && typeof record.result === 'object' && record.result !== null
        ? (record.result as Record<string, unknown>)
        : null,
    ];

    if (typeof record.data === 'number' || typeof record.data === 'string') {
      const fromData = this.normalizeBalanceValue(record.data);
      if (fromData != null) {
        return fromData;
      }
    }

    const fieldNames = [
      'balance',
      'Balance',
      'credit',
      'credits',
      'amount',
      'sms',
      'total_sms',
      'totalSms',
      'remaining_balance',
      'remainingBalance',
      'sms_balance',
      'smsBalance',
      'available_balance',
      'availableBalance',
    ];

    for (const object of nestedObjects) {
      if (!object) {
        continue;
      }
      for (const field of fieldNames) {
        const normalized = this.normalizeBalanceValue(object[field]);
        if (normalized != null) {
          return normalized;
        }
      }
    }

    return null;
  }

  private normalizeBalanceValue(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const normalized = value.trim().replace(/,/g, '');
      if (!Number.isNaN(Number(normalized))) {
        return normalized;
      }
    }
    return null;
  }

  extractCurrency(body: unknown): string | null {
    if (body == null || typeof body !== 'object') {
      return null;
    }

    const record = body as Record<string, unknown>;
    const data =
      record.data && typeof record.data === 'object' && record.data !== null
        ? (record.data as Record<string, unknown>)
        : null;

    for (const value of [record.currency, data?.currency]) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim().toUpperCase();
      }
    }

    return null;
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
      const msg =
        typeof record.msg === 'string' ? record.msg.toLowerCase() : '';
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
    if (
      /^your[\s_-]*shortcode/i.test(raw) ||
      raw.toLowerCase() === 'optional'
    ) {
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

  private async getJson(
    url: string,
    options?: { headers?: Record<string, string> },
  ): Promise<unknown> {
    const timeoutMs = this.getTimeoutMs();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: options?.headers,
        signal: controller.signal,
      });
    } catch (error) {
      this.logger.warn(
        `GeezSMS GET failed: ${
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
        `GeezSMS GET HTTP ${response.status}${snippet ? `: ${snippet}` : ''}`,
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
      this.logger.warn(`GeezSMS GET non-JSON body: ${rawText.slice(0, 200)}`);
      throw new SmsUnavailableException();
    }
  }

  private async postForm(
    url: string,
    form: FormData,
    options?: {
      allowTimeoutProvisional?: boolean;
      headers?: Record<string, string>;
    },
  ): Promise<unknown> {
    const timeoutMs = this.getTimeoutMs();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        body: form,
        headers: options?.headers,
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
    if (
      record.data &&
      typeof record.data === 'object' &&
      record.data !== null
    ) {
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
      record.data && typeof record.data === 'object' && record.data !== null
        ? (record.data as Record<string, unknown>).message_status
        : undefined,
      record.data && typeof record.data === 'object' && record.data !== null
        ? (record.data as Record<string, unknown>).status
        : undefined,
      record.data && typeof record.data === 'object' && record.data !== null
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
