import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeEthiopianPhone } from '../common/utils/phone.util';
import { GeezSmsProvider } from './providers/geezsms.provider';
import {
  SmsProviderAuthFailedException,
  SmsUnavailableException,
} from './sms.errors';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly geezSmsProvider: GeezSmsProvider,
  ) {}

  /**
   * Request GeezSMS OTP for a phone. Returns the 4-digit code Geez generated
   * so auth can hash/verify it locally.
   */
  async sendOtp(phone: string): Promise<string> {
    if (!this.isGeezSmsEnabled()) {
      throw new SmsUnavailableException();
    }

    const token = this.configService.get<string>('GEEZSMS_TOKEN');
    if (!token) {
      throw new SmsProviderAuthFailedException();
    }

    return this.geezSmsProvider.sendOtp(phone);
  }

  async sendSms(phone: string, msg: string): Promise<void> {
    if (!this.isGeezSmsEnabled()) {
      throw new SmsUnavailableException();
    }

    const token = this.configService.get<string>('GEEZSMS_TOKEN');
    if (!token) {
      throw new SmsProviderAuthFailedException();
    }

    await this.geezSmsProvider.sendSms(phone, msg);
  }

  async getBalance(): Promise<{
    enabled: boolean;
    balance: string | null;
    currency: string | null;
    error: string | null;
  }> {
    if (!this.isGeezSmsEnabled()) {
      return {
        enabled: false,
        balance: null,
        currency: null,
        error: 'GeezSMS is disabled. Set GEEZSMS_ENABLED=true in the API .env.',
      };
    }

    const token = this.configService.get<string>('GEEZSMS_TOKEN');
    if (!token) {
      return {
        enabled: true,
        balance: null,
        currency: null,
        error: 'GeezSMS token is not configured',
      };
    }

    try {
      const result = await this.geezSmsProvider.getBalance();
      return {
        enabled: true,
        balance: result.balance,
        currency: result.currency,
        error: null,
      };
    } catch (error) {
      const message =
        error instanceof SmsProviderAuthFailedException ||
        error instanceof SmsUnavailableException
          ? error.message
          : error instanceof Error
            ? error.message
            : 'GeezSMS balance unavailable';

      this.logger.warn(`Failed to fetch GeezSMS balance: ${message}`);
      return {
        enabled: true,
        balance: null,
        currency: null,
        error: message,
      };
    }
  }

  async notifyWithdrawalAdmins(params: {
    amount: string;
    provider: string;
  }): Promise<void> {
    if (!this.isWithdrawalAdminSmsEnabled()) {
      return;
    }

    const phones = this.parseAdminSmsPhones();
    if (phones.length === 0) {
      this.logger.warn(
        'WITHDRAWAL_ADMIN_SMS_ENABLED is true but ADMIN_SMS_PHONES has no valid numbers',
      );
      return;
    }

    const dashboardUrl = (
      this.configService.get<string>('ADMIN_DASHBOARD_URL') ?? ''
    )
      .trim()
      .replace(/\/$/, '');
    if (!dashboardUrl) {
      this.logger.warn(
        'WITHDRAWAL_ADMIN_SMS_ENABLED is true but ADMIN_DASHBOARD_URL is empty',
      );
      return;
    }

    const msg = `ወፃኢ ትዕዛዝ ይፅበዩ አለዉ: New withdrawal ${params.amount} ETB (${params.provider}). Review: ${dashboardUrl}/withdrawals`;

    for (const phone of phones) {
      try {
        await this.sendSms(phone, msg);
      } catch (error) {
        this.logger.warn(
          `Failed to send withdrawal admin SMS to ${phone}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private isGeezSmsEnabled(): boolean {
    return this.configService.get<boolean>('GEEZSMS_ENABLED') === true;
  }

  private isWithdrawalAdminSmsEnabled(): boolean {
    return (
      this.configService.get<boolean>('WITHDRAWAL_ADMIN_SMS_ENABLED') === true
    );
  }

  /** Parse comma-separated admin phones; normalize, dedupe, take first 2. */
  private parseAdminSmsPhones(): string[] {
    const raw = this.configService.get<string>('ADMIN_SMS_PHONES') ?? '';
    const seen = new Set<string>();
    const phones: string[] = [];

    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) {
        continue;
      }

      const normalized = normalizeEthiopianPhone(trimmed);
      if (!/^2519\d{8}$/.test(normalized)) {
        this.logger.warn(`Ignoring invalid ADMIN_SMS_PHONES entry: ${trimmed}`);
        continue;
      }

      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      phones.push(normalized);
      if (phones.length >= 2) {
        break;
      }
    }

    return phones;
  }
}
