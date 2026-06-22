import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  it('rejects blocked users during login', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'user-1',
          fullName: 'Blocked User',
          phoneNumber: '251912345678',
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

  it('logs in when the stored phone uses local format', async () => {
    const password = '12345678';
    const passwordHash = await bcrypt.hash(password, 10);
    const createdAt = new Date('2026-06-03T09:00:00.000Z');
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'user-1',
          fullName: 'Samuel Mulu',
          phoneNumber: '0962520885',
          role: UserRole.PLAYER,
          status: UserStatus.ACTIVE,
          createdAt,
          updatedAt: createdAt,
          password: passwordHash,
          wallet: {
            id: 'wallet-1',
            userId: 'user-1',
            balance: new Prisma.Decimal('0'),
            lockedBalance: new Prisma.Decimal('0'),
            createdAt,
            updatedAt: createdAt,
          },
        }),
      },
    };

    const service = new AuthService(
      prisma as never,
      { signAsync: jest.fn().mockResolvedValue('access-token') } as never,
      {
        verifyRegistrationOtp: jest.fn(),
        verifyPasswordResetOtp: jest.fn(),
      } as never,
      {
        createRefreshToken: jest
          .fn()
          .mockResolvedValue({ token: 'refresh-token' }),
      } as never,
    );

    const result = await service.login({
      phoneNumber: '0962520885',
      password,
    });

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ phoneNumber: '251962520885' }, { phoneNumber: '0962520885' }],
        },
      }),
    );
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(result.user.phoneNumber).toBe('0962520885');
  });

  it('registers successfully with otp 123456', async () => {
    const createdAt = new Date('2026-06-03T09:00:00.000Z');
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'user-1',
          fullName: 'Samuel Mulu',
          phoneNumber: '251912345678',
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
      verifyRegistrationOtp: jest.fn().mockResolvedValue(undefined),
      verifyPasswordResetOtp: jest.fn(),
    };

    const service = new AuthService(
      prisma as never,
      { signAsync: jest.fn().mockResolvedValue('access-token') } as never,
      otpService as never,
      {
        createRefreshToken: jest
          .fn()
          .mockResolvedValue({ token: 'refresh-token' }),
      } as never,
    );

    const result = await service.register({
      fullName: 'Samuel Mulu',
      phoneNumber: '0912345678',
      password: '12345678',
      otp: '123456',
    });

    expect(otpService.verifyRegistrationOtp).toHaveBeenCalledWith(
      '251912345678',
      '123456',
    );
    expect(tx.user.create).toHaveBeenCalled();
    expect(tx.wallet.create).toHaveBeenCalled();
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(result.user.phoneNumber).toBe('251912345678');
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
      {} as never,
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

  it('reset password succeeds with otp 123456', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'user-1',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'user-1',
        }),
      },
    };

    const service = new AuthService(
      prisma as never,
      { signAsync: jest.fn() } as never,
      {
        verifyRegistrationOtp: jest.fn(),
        verifyPasswordResetOtp: jest.fn().mockResolvedValue(undefined),
      } as never,
      {} as never,
    );

    const result = await service.resetPassword({
      phoneNumber: '0912345678',
      otp: '123456',
      newPassword: '87654321',
    });

    expect(result).toEqual({
      message: 'Password reset successful',
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ phoneNumber: '251912345678' }, { phoneNumber: '0912345678' }],
        },
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: {
          password: expect.any(String),
        },
      }),
    );
    expect(prisma.user.update.mock.calls[0][0].data.password).not.toBe(
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
      {} as never,
    );

    await expect(
      service.resetPassword({
        phoneNumber: '0912345678',
        otp: '0000',
        newPassword: '87654321',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects blocked users during refresh', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          fullName: 'Blocked User',
          phoneNumber: '251912345678',
          role: UserRole.PLAYER,
          status: UserStatus.BLOCKED,
          createdAt: new Date(),
          updatedAt: new Date(),
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
      {
        rotateRefreshToken: jest.fn().mockResolvedValue({
          userId: 'user-1',
          newTokenPair: {
            accessToken: '',
            refreshToken: 'refresh-next',
          },
        }),
      } as never,
    );

    await expect(
      service.refreshTokens('refresh-old', 'device-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
