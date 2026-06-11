import { Prisma, WalletTransactionType } from '@prisma/client';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  function createService() {
    const wallet = {
      id: 'wallet-1',
      userId: 'user-1',
      balance: new Prisma.Decimal('100'),
      lockedBalance: new Prisma.Decimal('0'),
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    };

    const tx = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue(wallet),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          ...wallet,
          balance: data.balance ?? wallet.balance,
          lockedBalance: data.lockedBalance ?? wallet.lockedBalance,
        })),
      },
      walletTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'ledger-1' }),
      },
    };

    const prisma = {
      wallet: tx.wallet,
      walletTransaction: tx.walletTransaction,
    };

    const service = new WalletService(prisma as never);

    return { service, tx, wallet };
  }

  it('skips duplicate creditWallet calls for the same ledger reference', async () => {
    const { service, tx } = createService();
    tx.walletTransaction.findUnique.mockResolvedValue({ id: 'ledger-existing' });

    await service.creditWallet(tx as never, 'user-1', new Prisma.Decimal('10'), {
      type: WalletTransactionType.DEPOSIT,
      referenceType: 'deposit',
      referenceId: 'deposit-1',
      description: 'Approved deposit',
    });

    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
  });

  it('skips duplicate debitWallet calls for the same ledger reference', async () => {
    const { service, tx } = createService();
    tx.walletTransaction.findUnique.mockResolvedValue({ id: 'ledger-existing' });

    await service.debitWallet(tx as never, 'user-1', new Prisma.Decimal('10'), {
      type: WalletTransactionType.GAME_ENTRY,
      referenceType: 'GAME_CARTELA',
      referenceId: 'gc-1',
      description: 'Game entry fee',
    });

    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
  });
});
