import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WalletService } from './wallet.service';

describe('WalletService bonus cartelas', () => {
  const walletRecord = {
    id: 'wallet-1',
    userId: 'user-1',
    balance: new Prisma.Decimal('100'),
    lockedBalance: new Prisma.Decimal('0'),
    bonusCartelaBalance: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function createService() {
    const db = {
      wallet: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(walletRecord),
        findUnique: jest.fn().mockResolvedValue(walletRecord),
      },
    };

    const prisma = {} as never;
    const service = new WalletService(prisma);
    return { service, db };
  }

  it('consumes one bonus cartela atomically', async () => {
    const { service, db } = createService();

    const wallet = await service.consumeBonusCartela(db as never, 'user-1');

    expect(db.wallet.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        bonusCartelaBalance: { gte: 1 },
      },
      data: {
        bonusCartelaBalance: { decrement: 1 },
      },
    });
    expect(wallet.bonusCartelaBalance).toBe(10);
  });

  it('rejects bonus consumption when balance is insufficient', async () => {
    const { service, db } = createService();
    db.wallet.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.consumeBonusCartela(db as never, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('credits bonus cartelas back on refund', async () => {
    const { service, db } = createService();

    await service.creditBonusCartelas(db as never, 'user-1', 2);

    expect(db.wallet.update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: {
        bonusCartelaBalance: { increment: 2 },
      },
    });
  });
});
