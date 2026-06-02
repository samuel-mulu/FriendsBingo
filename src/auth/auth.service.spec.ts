import { ForbiddenException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
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
          password: '$2b$10$abcdefghijklmnopqrstuv123456789012345678901234567890',
          wallet: {
            id: 'wallet-1',
            userId: 'user-1',
            balance: { toString: () => '0.00' },
            lockedBalance: { toString: () => '0.00' },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      },
    };

    const service = new AuthService(
      prisma as never,
      { signAsync: jest.fn() } as never,
    );

    await expect(
      service.login({
        phoneNumber: '0912345678',
        password: '12345678',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
