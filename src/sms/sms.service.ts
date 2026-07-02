import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeezSmsProvider } from './providers/geezsms.provider';
import {
  SmsProviderAuthFailedException,
  SmsUnavailableException,
} from './sms.errors';

@Injectable()
export class SmsService {
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

  private isGeezSmsEnabled(): boolean {
    return this.configService.get<boolean>('GEEZSMS_ENABLED') === true;
  }
}
