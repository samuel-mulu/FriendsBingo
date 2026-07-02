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

    const params = new URLSearchParams();
    params.set('token', token);
    params.set('phone', phone);
    params.set(
      'msg',
      `Your Friends Bin.. OTP is ${code}. It expires in 5 minutes.`,
    );

    const shortcodeId = this.configService.get<string>('GEEZSMS_SHORTCODE_ID');
    if (shortcodeId) {
      params.set('shortcode_id', shortcodeId);
    }

    const url = `${baseUrl.replace(/\/$/, '')}/sms/send?${params.toString()}`;

    let response: Response;
    try {
      response = await fetch(url, { method: 'GET' });
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
