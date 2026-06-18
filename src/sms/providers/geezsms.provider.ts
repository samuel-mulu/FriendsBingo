import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SmsProviderAuthFailedException,
  SmsRateLimitedException,
  SmsUnavailableException,
} from '../sms.errors';

@Injectable()
export class GeezSmsProvider {
  constructor(private readonly configService: ConfigService) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const token = this.configService.get<string>('GEEZSMS_TOKEN');
    const baseUrl =
      this.configService.get<string>('GEEZSMS_BASE_URL') ??
      'https://api.geezsms.com/api/v1';

    if (!token) {
      throw new SmsProviderAuthFailedException();
    }

    const url = `${baseUrl.replace(/\/$/, '')}/sms/send`;
    const body = new URLSearchParams();
    body.set('token', token);
    body.set('phone', phone);
    body.set(
      'msg',
      `Your Friends Bingo OTP is ${code}. It expires in 5 minutes.`,
    );

    const shortcodeId = this.configService.get<string>('GEEZSMS_SHORTCODE_ID');
    if (shortcodeId) {
      body.set('shortcode_id', shortcodeId);
    }

    const callbackUrl = this.configService.get<string>('GEEZSMS_CALLBACK_URL');
    if (callbackUrl) {
      body.set('callback', callbackUrl);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
    } catch {
      throw new SmsUnavailableException();
    }

    if (response.status === 401 || response.status === 403) {
      throw new SmsProviderAuthFailedException();
    }

    if (response.status === 429) {
      throw new SmsRateLimitedException();
    }

    if (!response.ok) {
      throw new SmsUnavailableException();
    }
  }
}
