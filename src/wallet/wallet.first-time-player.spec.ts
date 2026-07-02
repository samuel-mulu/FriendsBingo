import { GameCartelaStatus, Prisma } from '@prisma/client';
import { WalletService } from './wallet.service';

const completedCartelaRegistrationStatuses = [
  GameCartelaStatus.REGISTERED,
  GameCartelaStatus.WINNER,
  GameCartelaStatus.BLOCKED,
  GameCartelaStatus.CANCELLED,
] as const;

describe('WalletService first-time player', () => {
  function createService(completedRegistrationCount: number) {
    const wallet = {
      id: 'wallet-1',
      userId: 'user-1',
      balance: new Prisma.Decimal('0'),
      lockedBalance: new Prisma.Decimal('0'),
      bonusCartelaBalance: 10,
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    };

    const prisma = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue(wallet),
      },
      gameCartela: {
        count: jest.fn().mockResolvedValue(completedRegistrationCount),
      },
    };

    return {
      service: new WalletService(prisma as never),
      prisma,
    };
  }

  it('marks player as first-time when they have never completed a registration', async () => {
    const { service, prisma } = createService(0);

    const wallet = await service.getSerializedWallet('user-1');

    expect(prisma.gameCartela.count).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        status: {
          in: [...completedCartelaRegistrationStatuses],
        },
      },
    });
    expect(wallet.isFirstTimePlayer).toBe(true);
    expect(wallet.bonusCartelaBalance).toBe(10);
  });

  it('marks player as returning after any completed registration', async () => {
    const { service } = createService(1);

    const wallet = await service.getSerializedWallet('user-1');

    expect(wallet.isFirstTimePlayer).toBe(false);
  });

  it('treats cancelled registrations as not first-time', async () => {
    const { service } = createService(1);

    const wallet = await service.getSerializedWallet('user-1');

    expect(wallet.isFirstTimePlayer).toBe(false);
  });
});
