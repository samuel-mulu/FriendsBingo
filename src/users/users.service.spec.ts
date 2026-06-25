import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';

describe('UsersService', () => {
  it('returns paginated admin users without exposing passwords', async () => {
    const prisma = {
      user: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'user-1',
            fullName: 'Samuel Mulu',
            phoneNumber: '0912345678',
            role: 'PLAYER',
            status: 'ACTIVE',
            createdAt: new Date('2026-06-01T00:00:00.000Z'),
            wallet: {
              balance: { toString: () => '250.00' },
            },
            password: 'hidden',
          },
        ]),
      },
    };

    const service = new UsersService(prisma as never);

    const result = await service.getAdminUsers({
      page: 1,
      pageSize: 20,
    });

    expect(prisma.user.count).toHaveBeenCalledWith({ where: {} });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
    expect(result.items).toEqual([
      {
        id: 'user-1',
        fullName: 'Samuel Mulu',
        phoneNumber: '0912345678',
        role: 'PLAYER',
        status: 'ACTIVE',
        walletBalance: '250.00',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ]);
  });

  it('filters admin users by role when requested', async () => {
    const prisma = {
      user: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const service = new UsersService(prisma as never);

    await service.getAdminUsers({
      page: 1,
      pageSize: 20,
      role: 'ADMIN',
    });

    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { role: 'ADMIN' },
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'ADMIN' },
      }),
    );
  });

  it('returns admin user detail with wallet and counts', async () => {
    const prisma = {
      gameCartela: {
        count: jest.fn().mockResolvedValue(2),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          fullName: 'Samuel Mulu',
          phoneNumber: '0912345678',
          role: 'PLAYER',
          status: 'ACTIVE',
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          updatedAt: new Date('2026-06-02T00:00:00.000Z'),
          wallet: {
            id: 'wallet-1',
            userId: 'user-1',
            balance: new Prisma.Decimal('250.00'),
            lockedBalance: new Prisma.Decimal('50.00'),
            createdAt: new Date('2026-06-01T00:00:00.000Z'),
            updatedAt: new Date('2026-06-02T00:00:00.000Z'),
          },
          _count: {
            deposits: 2,
            withdrawals: 1,
            gameCartelas: 4,
            transactions: 7,
          },
          password: 'hidden',
        }),
      },
    };

    const service = new UsersService(prisma as never);

    const result = await service.getAdminUserById('user-1');

    expect(result.wallet).toEqual({
      id: 'wallet-1',
      userId: 'user-1',
      balance: '250',
      lockedBalance: '50',
      totalBalance: '300',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    });
    expect(result.counts.transactions).toBe(7);
    expect(result.counts.winnerCartelas).toBe(2);
  });
});
