import { Prisma, WalletTransactionType } from '@prisma/client';
import { WalletService } from './wallet.service';

describe('WalletService withdrawal lifecycle', () => {
  function createHarness(initialBalance = '1000', initialLocked = '0') {
    const wallet = {
      id: 'wallet-1',
      userId: 'user-1',
      balance: new Prisma.Decimal(initialBalance),
      lockedBalance: new Prisma.Decimal(initialLocked),
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    };

    const tx = {
      wallet: {
        findUnique: jest.fn().mockImplementation(async () => ({ ...wallet })),
        update: jest.fn().mockImplementation(async ({ data }) => {
          if (data.balance !== undefined) {
            wallet.balance = data.balance;
          }
          if (data.lockedBalance !== undefined) {
            wallet.lockedBalance = data.lockedBalance;
          }
          wallet.updatedAt = new Date();
          return wallet;
        }),
      },
      walletTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'ledger-1' }),
      },
    };

    // WalletService reads wallet via findUnique on each call; keep wallet object in sync.
    tx.wallet.findUnique.mockImplementation(async () => wallet);

    const service = new WalletService(tx as never);
    const total = () => wallet.balance.plus(wallet.lockedBalance);

    return { service, tx, wallet, total };
  }

  it('keeps total unchanged when moving balance to locked', async () => {
    const { service, tx, wallet, total } = createHarness('1000', '0');

    await service.moveBalanceToLocked(
      tx as never,
      'user-1',
      new Prisma.Decimal('500'),
      {
        type: WalletTransactionType.WITHDRAW_REQUEST,
        referenceType: 'withdrawal',
        referenceId: 'withdrawal-1',
        description: 'Withdrawal request',
      },
    );

    expect(wallet.balance.toString()).toBe('500');
    expect(wallet.lockedBalance.toString()).toBe('500');
    expect(total().toString()).toBe('1000');
  });

  it('reduces total when consuming locked funds on payout', async () => {
    const { service, tx, wallet, total } = createHarness('500', '500');

    await service.consumeLockedFunds(
      tx as never,
      'user-1',
      new Prisma.Decimal('500'),
      {
        type: WalletTransactionType.WITHDRAW_PAID,
        referenceType: 'withdrawal',
        referenceId: 'withdrawal-1',
        description: 'Paid withdrawal',
      },
    );

    expect(wallet.balance.toString()).toBe('500');
    expect(wallet.lockedBalance.toString()).toBe('0');
    expect(total().toString()).toBe('500');
  });

  it('restores available balance when releasing locked funds on reject', async () => {
    const { service, tx, wallet, total } = createHarness('500', '500');

    await service.releaseLockedFunds(
      tx as never,
      'user-1',
      new Prisma.Decimal('500'),
      {
        type: WalletTransactionType.WITHDRAW_REFUND,
        referenceType: 'withdrawal',
        referenceId: 'withdrawal-1',
        description: 'Rejected withdrawal',
      },
    );

    expect(wallet.balance.toString()).toBe('1000');
    expect(wallet.lockedBalance.toString()).toBe('0');
    expect(total().toString()).toBe('1000');
  });

  it('runs the full request, payout, and reject lifecycle', async () => {
    const request = createHarness('1000', '0');

    await request.service.moveBalanceToLocked(
      request.tx as never,
      'user-1',
      new Prisma.Decimal('500'),
      {
        type: WalletTransactionType.WITHDRAW_REQUEST,
        referenceType: 'withdrawal',
        referenceId: 'withdrawal-1',
        description: 'Withdrawal request',
      },
    );

    expect(request.total().toString()).toBe('1000');

    const payout = createHarness('500', '500');
    await payout.service.consumeLockedFunds(
      payout.tx as never,
      'user-1',
      new Prisma.Decimal('500'),
      {
        type: WalletTransactionType.WITHDRAW_PAID,
        referenceType: 'withdrawal',
        referenceId: 'withdrawal-1',
        description: 'Paid withdrawal',
      },
    );

    expect(payout.total().toString()).toBe('500');

    const reject = createHarness('500', '500');
    await reject.service.releaseLockedFunds(
      reject.tx as never,
      'user-1',
      new Prisma.Decimal('500'),
      {
        type: WalletTransactionType.WITHDRAW_REFUND,
        referenceType: 'withdrawal',
        referenceId: 'withdrawal-2',
        description: 'Rejected withdrawal',
      },
    );

    expect(reject.total().toString()).toBe('1000');
  });
});
