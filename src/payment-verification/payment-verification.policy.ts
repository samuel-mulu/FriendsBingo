import { ConfigService } from '@nestjs/config';

export function isMockPaymentVerificationAllowed(
  configService: ConfigService,
): boolean {
  if (configService.get<string>('NODE_ENV') === 'production') {
    return configService.get<boolean>('PAYMENT_MOCK_VERIFICATION_ALLOWED') ===
      true;
  }

  return true;
}
