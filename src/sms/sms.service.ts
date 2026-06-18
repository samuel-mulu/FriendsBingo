import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeezSmsProvider } from './providers/geezsms.provider';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly geezSmsProvider: GeezSmsProvider,
  ) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const mode = this.getOtpMode();

    if (mode === 'mock') {
      if (!this.isProduction()) {
        this.logger.log(`[OTP:mock] phone=${phone} code=${code}`);
      }
      return;
    }

    if (!this.isGeezSmsEnabled()) {
      throw new Error('GeezSMS is not enabled');
    }

    await this.geezSmsProvider.sendOtp(phone, code);
  }

  getOtpMode(): 'mock' | 'geezsms' {
    const configured = this.configService.get<string>('OTP_MODE');
    if (configured === 'mock' || configured === 'geezsms') {
      return configured;
    }

    if (
      this.configService.get<boolean>('OTP_ALLOW_MOCK') === true &&
      !this.isProduction()
    ) {
      return 'mock';
    }

    return this.isProduction() ? 'geezsms' : 'mock';
  }

  getDevOtpCode(): string {
    return this.configService.get<string>('DEV_OTP_CODE') ?? '123456';
  }

  private isGeezSmsEnabled(): boolean {
    return this.configService.get<boolean>('GEEZSMS_ENABLED') === true;
  }

  private isProduction(): boolean {
    return this.configService.get<string>('NODE_ENV') === 'production';
  }
}
