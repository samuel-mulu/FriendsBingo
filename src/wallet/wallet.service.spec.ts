import { BadRequestException } from '@nestjs/common';
import { Prisma, WalletTransactionType } from '@prisma/client';
import { WalletService } from './wallet.service';

type WalletRow = {
  id: string;
  userId: string;
  balance: Prisma.Decimal;
  lockedBalance: Prisma.Decimal;
  createdAt: Date;
  updatedAt: Date;
};

type WalletTransactionRow = {
  id: string;
  userId: string;
  type: WalletTransactionType;
  amount: Prisma.Decimal;
  balanceBefore: Prisma.Decimal;
  balanceAfter: Prisma.Decimal;
  referenceType: string | null;
  referenceId: string | null;
  description: string | null;
  createdAt: Date;
};

type StoreState = {
  wallet: WalletRow;
  transactions: WalletTransactionRow[];
  nextLedgerId: number;
};

function cloneWallet(wallet: WalletRow): WalletRow {
  return {
    ...wallet,
    balance: new Prisma.Decimal(wallet.balance.toString()),
    lockedBalance: new Prisma.Decimal(wallet.lockedBalance.toString()),
    createdAt: new Date(wallet.createdAt),
    updatedAt: new Date(wallet.updatedAt),
  };
}

function cloneTransaction(
  transaction: WalletTransactionRow,
): WalletTransactionRow {
  return {
    ...transaction,
    amount: new Prisma.Decimal(transaction.amount.toString()),
    balanceBefore: new Prisma.Decimal(transaction.balanceBefore.toString()),
    balanceAfter: new Prisma.Decimal(transaction.balanceAfter.toString()),
    createdAt: new Date(transaction.createdAt),
  };
}

function cloneState(state: StoreState): StoreState {
  return {
    wallet: cloneWallet(state.wallet),
    transactions: state.transactions.map(cloneTransaction),
    nextLedgerId: state.nextLedgerId,
  };
}

function pickSelected<T extends Record<string, unknown>>(
  value: T | null,
  select?: Record<string, boolean>,
) {
  if (!value || !select) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(select)
      .filter(([, enabled]) => enabled)
      .map(([key]) => [key, value[key as keyof T]]),
  );
}

function createInMemoryWalletHarness(options?: {
  balance?: string;
  lockedBalance?: string;
}) {
  const committed: StoreState = {
    wallet: {
      id: 'wallet-1',
      userId: 'user-1',
      balance: new Prisma.Decimal(options?.balance ?? '100.00'),
      lockedBalance: new Prisma.Decimal(options?.lockedBalance ?? '0.00'),
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    },
    transactions: [],
    nextLedgerId: 1,
  };

  const createUniqueConstraintError = () => ({ code: 'P2002' });

  const findTransactionByBusinessKey = (
    state: StoreState,
    where: {
      userId: string;
      type: WalletTransactionType;
      referenceType: string;
      referenceId: string;
    },
  ) =>
    state.transactions.find(
      (transaction) =>
        transaction.userId === where.userId &&
        transaction.type === where.type &&
        transaction.referenceType === where.referenceType &&
        transaction.referenceId === where.referenceId,
    ) ?? null;

  const createTx = (state: StoreState) => ({
    wallet: {
      findUnique: jest.fn(async ({ where, select }) => {
        if (where.userId !== state.wallet.userId) {
          return null;
        }

        return pickSelected(state.wallet, select);
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        if (where.userId !== state.wallet.userId) {
          return { count: 0 };
        }

        if (
          where.balance?.gte &&
          state.wallet.balance.lt(where.balance.gte.toString())
        ) {
          return { count: 0 };
        }

        if (
          where.lockedBalance?.gte &&
          state.wallet.lockedBalance.lt(where.lockedBalance.gte.toString())
        ) {
          return { count: 0 };
        }

        if (data.balance?.increment) {
          state.wallet.balance = state.wallet.balance.plus(
            data.balance.increment.toString(),
          );
        }

        if (data.balance?.decrement) {
          state.wallet.balance = state.wallet.balance.minus(
            data.balance.decrement.toString(),
          );
        }

        if (data.lockedBalance?.increment) {
          state.wallet.lockedBalance = state.wallet.lockedBalance.plus(
            data.lockedBalance.increment.toString(),
          );
        }

        if (data.lockedBalance?.decrement) {
          state.wallet.lockedBalance = state.wallet.lockedBalance.minus(
            data.lockedBalance.decrement.toString(),
          );
        }

        state.wallet.updatedAt = new Date();
        return { count: 1 };
      }),
    },
    walletTransaction: {
      findUnique: jest.fn(async ({ where, select }) => {
        const key = where.userId_type_referenceType_referenceId;
        const transaction = findTransactionByBusinessKey(state, key);
        return pickSelected(transaction, select);
      }),
      create: jest.fn(async ({ data, select }) => {
        const existing = findTransactionByBusinessKey(state, {
          userId: data.userId,
          type: data.type,
          referenceType: data.referenceType,
          referenceId: data.referenceId,
        });
        if (existing) {
          throw createUniqueConstraintError();
        }

        const transaction: WalletTransactionRow = {
          id: `ledger-${state.nextLedgerId++}`,
          userId: data.userId,
          type: data.type,
          amount: new Prisma.Decimal(data.amount.toString()),
          balanceBefore: new Prisma.Decimal(data.balanceBefore.toString()),
          balanceAfter: new Prisma.Decimal(data.balanceAfter.toString()),
          referenceType: data.referenceType,
          referenceId: data.referenceId,
          description: data.description ?? null,
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
        };
        state.transactions.push(transaction);
        return pickSelected(transaction, select);
      }),
      update: jest.fn(async ({ where, data }) => {
        const transaction = state.transactions.find(
          (entry) => entry.id === where.id,
        );
        if (!transaction) {
          throw new Error('Transaction not found');
        }

        transaction.balanceBefore = new Prisma.Decimal(
          data.balanceBefore.toString(),
        );
        transaction.balanceAfter = new Prisma.Decimal(
          data.balanceAfter.toString(),
        );

        return transaction;
      }),
      delete: jest.fn(async ({ where }) => {
        const index = state.transactions.findIndex(
          (entry) => entry.id === where.id,
        );
        if (index === -1) {
          throw new Error('Transaction not found');
        }

        const [deleted] = state.transactions.splice(index, 1);
        return deleted;
      }),
    },
  });

  const prisma = {
    wallet: createTx(committed).wallet,
    walletTransaction: createTx(committed).walletTransaction,
  };

  const service = new WalletService(prisma as never);

  return {
    service,
    readCommittedState: () => cloneState(committed),
    async runInTransaction<T>(callback: (tx: ReturnType<typeof createTx>) => Promise<T>) {
      const draft = cloneState(committed);
      const tx = createTx(draft);

      try {
        const result = await callback(tx);
        committed.wallet = cloneWallet(draft.wallet);
        committed.transactions = draft.transactions.map(cloneTransaction);
        committed.nextLedgerId = draft.nextLedgerId;
        return result;
      } catch (error) {
        throw error;
      }
    },
  };
}

describe('WalletService atomic mutations', () => {
  it('credits a deposit exactly once for repeated concurrent retries', async () => {
    const { service, readCommittedState, runInTransaction } =
      createInMemoryWalletHarness({ balance: '0.00' });

    await runInTransaction(async (tx) => {
      await Promise.all([
        service.creditWallet(tx as never, 'user-1', new Prisma.Decimal('25'), {
          type: WalletTransactionType.DEPOSIT,
          referenceType: 'deposit',
          referenceId: 'deposit-1',
          description: 'Approved deposit',
        }),
        service.creditWallet(tx as never, 'user-1', new Prisma.Decimal('25'), {
          type: WalletTransactionType.DEPOSIT,
          referenceType: 'deposit',
          referenceId: 'deposit-1',
          description: 'Approved deposit',
        }),
      ]);
    });

    const committed = readCommittedState();
    expect(committed.wallet.balance.toString()).toBe('25');
    expect(committed.transactions).toHaveLength(1);
    expect(committed.transactions[0].balanceBefore.toString()).toBe('0');
    expect(committed.transactions[0].balanceAfter.toString()).toBe('25');
  });

  it('prevents two concurrent debits from overdrafting the wallet', async () => {
    const { service, runInTransaction, readCommittedState } =
      createInMemoryWalletHarness({ balance: '10.00' });

    await runInTransaction(async (tx) => {
      const results = await Promise.allSettled([
        service.debitWallet(tx as never, 'user-1', new Prisma.Decimal('10'), {
          type: WalletTransactionType.GAME_ENTRY,
          referenceType: 'GAME_CARTELA',
          referenceId: 'gc-1',
          description: 'Game entry fee',
        }),
        service.debitWallet(tx as never, 'user-1', new Prisma.Decimal('10'), {
          type: WalletTransactionType.GAME_ENTRY,
          referenceType: 'GAME_CARTELA',
          referenceId: 'gc-2',
          description: 'Game entry fee',
        }),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
      expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(
        BadRequestException,
      );
    });

    const committed = readCommittedState();
    expect(committed.wallet.balance.toString()).toBe('0');
    expect(committed.transactions).toHaveLength(1);
  });

  it('fails debit when balance is insufficient', async () => {
    const { service, runInTransaction, readCommittedState } =
      createInMemoryWalletHarness({ balance: '5.00' });

    await expect(
      runInTransaction((tx) =>
        service.debitWallet(tx as never, 'user-1', new Prisma.Decimal('10'), {
          type: WalletTransactionType.GAME_ENTRY,
          referenceType: 'GAME_CARTELA',
          referenceId: 'gc-1',
          description: 'Game entry fee',
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const committed = readCommittedState();
    expect(committed.wallet.balance.toString()).toBe('5');
    expect(committed.transactions).toHaveLength(0);
  });

  it('keeps refunds idempotent', async () => {
    const { service, runInTransaction, readCommittedState } =
      createInMemoryWalletHarness({ balance: '0.00' });

    await runInTransaction(async (tx) => {
      await service.creditWallet(tx as never, 'user-1', new Prisma.Decimal('10'), {
        type: WalletTransactionType.REFUND,
        referenceType: 'GAME_SESSION_CANCEL',
        referenceId: 'session-1:user-1',
        description: 'Cancelled game refund',
      });
      await service.creditWallet(tx as never, 'user-1', new Prisma.Decimal('10'), {
        type: WalletTransactionType.REFUND,
        referenceType: 'GAME_SESSION_CANCEL',
        referenceId: 'session-1:user-1',
        description: 'Cancelled game refund',
      });
    });

    const committed = readCommittedState();
    expect(committed.wallet.balance.toString()).toBe('10');
    expect(committed.transactions).toHaveLength(1);
  });

  it('keeps winner payouts idempotent', async () => {
    const { service, runInTransaction, readCommittedState } =
      createInMemoryWalletHarness({ balance: '0.00' });

    await runInTransaction(async (tx) => {
      await service.creditWallet(tx as never, 'user-1', new Prisma.Decimal('80'), {
        type: WalletTransactionType.PRIZE_WIN,
        referenceType: 'GAME_CARTELA',
        referenceId: 'gc-winner-1',
        description: 'Prize win',
      });
      await service.creditWallet(tx as never, 'user-1', new Prisma.Decimal('80'), {
        type: WalletTransactionType.PRIZE_WIN,
        referenceType: 'GAME_CARTELA',
        referenceId: 'gc-winner-1',
        description: 'Prize win',
      });
    });

    const committed = readCommittedState();
    expect(committed.wallet.balance.toString()).toBe('80');
    expect(committed.transactions).toHaveLength(1);
  });

  it('keeps withdrawal debits idempotent', async () => {
    const { service, runInTransaction, readCommittedState } =
      createInMemoryWalletHarness({ balance: '100.00', lockedBalance: '0.00' });

    await runInTransaction(async (tx) => {
      await service.moveBalanceToLocked(
        tx as never,
        'user-1',
        new Prisma.Decimal('40'),
        {
          type: WalletTransactionType.WITHDRAW_REQUEST,
          referenceType: 'withdrawal',
          referenceId: 'withdrawal-1',
          description: 'Withdrawal request',
        },
      );
      await service.moveBalanceToLocked(
        tx as never,
        'user-1',
        new Prisma.Decimal('40'),
        {
          type: WalletTransactionType.WITHDRAW_REQUEST,
          referenceType: 'withdrawal',
          referenceId: 'withdrawal-1',
          description: 'Withdrawal request',
        },
      );
    });

    const committed = readCommittedState();
    expect(committed.wallet.balance.toString()).toBe('60');
    expect(committed.wallet.lockedBalance.toString()).toBe('40');
    expect(committed.transactions).toHaveLength(1);
  });

  it('keeps ledger and balances consistent after repeated calls', async () => {
    const { service, runInTransaction, readCommittedState } =
      createInMemoryWalletHarness({ balance: '100.00', lockedBalance: '0.00' });

    await runInTransaction(async (tx) => {
      await service.debitWallet(tx as never, 'user-1', new Prisma.Decimal('10'), {
        type: WalletTransactionType.GAME_ENTRY,
        referenceType: 'GAME_CARTELA',
        referenceId: 'gc-1',
        description: 'Game entry fee',
      });
      await service.debitWallet(tx as never, 'user-1', new Prisma.Decimal('10'), {
        type: WalletTransactionType.GAME_ENTRY,
        referenceType: 'GAME_CARTELA',
        referenceId: 'gc-1',
        description: 'Game entry fee',
      });
      await service.creditWallet(tx as never, 'user-1', new Prisma.Decimal('10'), {
        type: WalletTransactionType.REFUND,
        referenceType: 'GAME_SESSION_CANCEL',
        referenceId: 'session-1:user-1',
        description: 'Refund',
      });
    });

    const committed = readCommittedState();
    expect(committed.wallet.balance.toString()).toBe('100');
    expect(committed.transactions).toHaveLength(2);
    expect(committed.transactions.map((transaction) => transaction.type)).toEqual(
      [WalletTransactionType.GAME_ENTRY, WalletTransactionType.REFUND],
    );
  });

  it('rolls back ledger and balance together when caller transaction fails', async () => {
    const { service, runInTransaction, readCommittedState } =
      createInMemoryWalletHarness({ balance: '100.00', lockedBalance: '0.00' });

    await expect(
      runInTransaction(async (tx) => {
        await service.debitWallet(
          tx as never,
          'user-1',
          new Prisma.Decimal('10'),
          {
            type: WalletTransactionType.GAME_ENTRY,
            referenceType: 'GAME_CARTELA',
            referenceId: 'gc-rollback',
            description: 'Game entry fee',
          },
        );

        throw new Error('Force rollback');
      }),
    ).rejects.toThrow('Force rollback');

    const committed = readCommittedState();
    expect(committed.wallet.balance.toString()).toBe('100');
    expect(committed.transactions).toHaveLength(0);
  });
});
