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

  async sendOtp(phone: string, code: string): Promise<void> {
    if (!this.isGeezSmsEnabled()) {
      throw new SmsUnavailableException();
    }

    const token = this.configService.get<string>('GEEZSMS_TOKEN');
    if (!token) {
      throw new SmsProviderAuthFailedException();
    }

    await this.geezSmsProvider.sendOtp(phone, code);
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
    ).trim().replace(/\/$/, '');
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
