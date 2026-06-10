import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  it('rejects blocked users during login', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          fullName: 'Blocked User',
          phoneNumber: '0912345678',
          role: UserRole.PLAYER,
          status: UserStatus.BLOCKED,
          createdAt: new Date(),
          updatedAt: new Date(),
          password:
            '$2b$10$abcdefghijklmnopqrstuv123456789012345678901234567890',
          wallet: {
            id: 'wallet-1',
            userId: 'user-1',
            balance: new Prisma.Decimal('0'),
            lockedBalance: new Prisma.Decimal('0'),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      },
    };

    const service = new AuthService(
      prisma as never,
      { signAsync: jest.fn() } as never,
      {
        verifyRegistrationOtp: jest.fn(),
        verifyPasswordResetOtp: jest.fn(),
      } as never,
    );

    await expect(
      service.login({
        phoneNumber: '0912345678',
        password: '12345678',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('registers successfully with otp 1234', async () => {
    const createdAt = new Date('2026-06-03T09:00:00.000Z');
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'user-1',
          fullName: 'Samuel Mulu',
          phoneNumber: '0912345678',
          role: UserRole.PLAYER,
          status: UserStatus.ACTIVE,
          createdAt,
          updatedAt: createdAt,
        }),
      },
      wallet: {
        create: jest.fn().mockResolvedValue({
          id: 'wallet-1',
          userId: 'user-1',
          balance: new Prisma.Decimal('0'),
          lockedBalance: new Prisma.Decimal('0'),
          createdAt,
          updatedAt: createdAt,
        }),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const otpService = {
      verifyRegistrationOtp: jest.fn(),
      verifyPasswordResetOtp: jest.fn(),
    };

    const service = new AuthService(
      prisma as never,
      { signAsync: jest.fn().mockResolvedValue('access-token') } as never,
      otpService as never,
    );

    const result = await service.register({
      fullName: 'Samuel Mulu',
      phoneNumber: '0912345678',
      password: '12345678',
      otp: '1234',
    });

    expect(otpService.verifyRegistrationOtp).toHaveBeenCalledWith(
      '0912345678',
      '1234',
    );
    expect(tx.user.create).toHaveBeenCalled();
    expect(tx.wallet.create).toHaveBeenCalled();
    expect(result.accessToken).toBe('access-token');
    expect(result.user.phoneNumber).toBe('0912345678');
    expect(result.user).not.toHaveProperty('password');
  });

  it('register requires a valid otp', async () => {
    const otpService = {
      verifyRegistrationOtp: jest.fn(() => {
        throw new UnauthorizedException('Invalid OTP');
      }),
      verifyPasswordResetOtp: jest.fn(),
    };

    const service = new AuthService(
      {} as never,
      { signAsync: jest.fn() } as never,
      otpService as never,
    );

    await expect(
      service.register({
        fullName: 'Samuel Mulu',
        phoneNumber: '0912345678',
        password: '12345678',
        otp: '9999',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('reset password succeeds with otp 1234', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const service = new AuthService(
      prisma as never,
      { signAsync: jest.fn() } as never,
      {
        verifyRegistrationOtp: jest.fn(),
        verifyPasswordResetOtp: jest.fn().mockResolvedValue(undefined),
      } as never,
    );

    const result = await service.resetPassword({
      phoneNumber: '0912345678',
      otp: '1234',
      newPassword: '87654321',
    });

    expect(result).toEqual({
      message: 'Password reset successful',
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { phoneNumber: '0912345678' },
        data: {
          password: expect.any(String),
        },
      }),
    );
    expect(prisma.user.updateMany.mock.calls[0][0].data.password).not.toBe(
      '87654321',
    );
  });

  it('reset password requires a valid otp', async () => {
    const service = new AuthService(
      {} as never,
      { signAsync: jest.fn() } as never,
      {
        verifyRegistrationOtp: jest.fn(),
        verifyPasswordResetOtp: jest
          .fn()
          .mockRejectedValue(new UnauthorizedException('Invalid OTP')),
      } as never,
    );

    await expect(
      service.resetPassword({
        phoneNumber: '0912345678',
        otp: '0000',
        newPassword: '87654321',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
