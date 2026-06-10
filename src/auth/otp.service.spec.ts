import { UnauthorizedException } from '@nestjs/common';
import { OtpService } from './otp.service';

describe('OtpService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const createService = (config: Record<string, unknown>) => {
    const service = new OtpService(prisma as never, {
      get: jest.fn((key: string) => config[key]),
    } as never);
    service.clearChallengesForTests();
    return service;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects fixed 1234 in production even when a challenge exists', () => {
    const service = createService({
      NODE_ENV: 'production',
      OTP_ALLOW_MOCK: false,
      OTP_EXPIRES_MINUTES: 10,
      OTP_MAX_ATTEMPTS: 5,
    });

    service.seedChallengeForTests('0912345678', 'REGISTER', '5678');

    expect(() =>
      service.verifyRegistrationOtp('0912345678', '1234'),
    ).toThrow(UnauthorizedException);
  });

  it('expires OTP after the configured lifetime', () => {
    const service = createService({
      NODE_ENV: 'test',
      OTP_ALLOW_MOCK: true,
      OTP_EXPIRES_MINUTES: 10,
      OTP_MAX_ATTEMPTS: 5,
    });

    service.seedChallengeForTests('0912345678', 'REGISTER', '1234', {
      expiresAt: new Date(Date.now() - 1_000),
    });

    expect(() =>
      service.verifyRegistrationOtp('0912345678', '1234'),
    ).toThrow(new UnauthorizedException('OTP expired or not requested'));
  });

  it('enforces max OTP attempts', () => {
    const service = createService({
      NODE_ENV: 'test',
      OTP_ALLOW_MOCK: true,
      OTP_EXPIRES_MINUTES: 10,
      OTP_MAX_ATTEMPTS: 3,
    });

    service.seedChallengeForTests('0912345678', 'REGISTER', '1234');

    expect(() =>
      service.verifyRegistrationOtp('0912345678', '0000'),
    ).toThrow(UnauthorizedException);
    expect(() =>
      service.verifyRegistrationOtp('0912345678', '0000'),
    ).toThrow(UnauthorizedException);
    expect(() =>
      service.verifyRegistrationOtp('0912345678', '0000'),
    ).toThrow(new UnauthorizedException('OTP attempts exceeded'));
  });

  it('allows mock OTP in non-production when OTP_ALLOW_MOCK is enabled', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const service = createService({
      NODE_ENV: 'test',
      OTP_ALLOW_MOCK: true,
      OTP_EXPIRES_MINUTES: 10,
      OTP_MAX_ATTEMPTS: 5,
    });

    await service.requestRegisterOtp('0912345678');

    expect(() =>
      service.verifyRegistrationOtp('0912345678', '1234'),
    ).not.toThrow();
  });
});
