import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { OtpPurpose } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { InMemoryRateLimiterService } from '../common/rate-limit/in-memory-rate-limiter.service';
import { normalizeEthiopianPhone } from '../common/utils/phone.util';
import { OtpService } from './otp.service';

describe('OtpService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
    },
    otpChallenge: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const smsService = {
    sendOtp: jest.fn(),
    getOtpMode: jest.fn(() => 'mock'),
    getDevOtpCode: jest.fn(() => '123456'),
  };

  const rateLimiter = new InMemoryRateLimiterService();

  const createService = () =>
    new OtpService(
      prisma as never,
      {
        get: jest.fn((key: string) => {
          const config: Record<string, unknown> = {
            OTP_EXPIRES_MINUTES: 5,
            OTP_MAX_ATTEMPTS: 5,
            OTP_RESEND_COOLDOWN_SECONDS: 60,
            OTP_SEND_LIMIT_PER_PHONE: 3,
            OTP_SEND_WINDOW_MINUTES: 15,
          };
          return config[key];
        }),
      } as never,
      smsService as never,
      rateLimiter,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimiter.clearForTests();
    prisma.otpChallenge.deleteMany.mockResolvedValue({ count: 0 });
    prisma.otpChallenge.create.mockImplementation(async ({ data }) => ({
      id: 'otp-1',
      ...data,
    }));
    prisma.user.findFirst.mockResolvedValue(null);
    smsService.sendOtp.mockResolvedValue(undefined);
    prisma.otpChallenge.findFirst.mockResolvedValue(null);
  });

  it('stores hashed OTP on request and sends mock OTP', async () => {
    const service = createService();

    await service.requestRegisterOtp('0962520885');

    expect(prisma.otpChallenge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phoneNumber: '251962520885',
          purpose: OtpPurpose.REGISTER,
        }),
      }),
    );
    expect(smsService.sendOtp).toHaveBeenCalledWith('251962520885', '123456');
  });

  it('verifies OTP and marks challenge consumed', async () => {
    const service = createService();
    const hash = await bcrypt.hash('123456', 10);
    prisma.otpChallenge.findFirst.mockResolvedValue({
      id: 'otp-1',
      phoneNumber: '251962520885',
      purpose: OtpPurpose.REGISTER,
      codeHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      attemptCount: 0,
      consumedAt: null,
    });

    await expect(
      service.verifyRegistrationOtp('0962520885', '123456'),
    ).resolves.toBeUndefined();

    expect(prisma.otpChallenge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'otp-1' },
        data: { consumedAt: expect.any(Date) },
      }),
    );
  });

  it('rejects expired OTP', async () => {
    const service = createService();
    const hash = await bcrypt.hash('123456', 10);
    prisma.otpChallenge.findFirst.mockResolvedValue({
      id: 'otp-1',
      phoneNumber: '251962520885',
      purpose: OtpPurpose.REGISTER,
      codeHash: hash,
      expiresAt: new Date(Date.now() - 1_000),
      attemptCount: 0,
      consumedAt: null,
    });

    await expect(
      service.verifyRegistrationOtp('0962520885', '123456'),
    ).rejects.toThrow(new UnauthorizedException('Invalid or expired code'));
  });

  it('increments attempts on wrong OTP', async () => {
    const service = createService();
    const hash = await bcrypt.hash('123456', 10);
    prisma.otpChallenge.findFirst.mockResolvedValue({
      id: 'otp-1',
      phoneNumber: '251962520885',
      purpose: OtpPurpose.REGISTER,
      codeHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      attemptCount: 0,
      consumedAt: null,
    });

    await expect(
      service.verifyRegistrationOtp('0962520885', '000000'),
    ).rejects.toThrow(UnauthorizedException);

    expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: { attemptCount: { increment: 1 } },
    });
  });

  it('rejects register OTP when phone already registered', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
    const service = createService();

    await expect(
      service.requestRegisterOtp('0962520885'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('normalizes phone numbers consistently', () => {
    expect(normalizeEthiopianPhone('0962520885')).toBe('251962520885');
  });
});
