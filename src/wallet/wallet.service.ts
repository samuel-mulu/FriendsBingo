import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GameCartelaStatus,
  Prisma,
  WalletTransactionType,
} from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import {
  buildPaginationMeta,
  getPaginationParams,
} from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import { serializeWallet, serializeWalletTransaction } from './wallet.mapper';
import {
  walletSelect,
  walletTransactionSelect,
  type WalletRecord,
} from './wallet.select';

type PrismaDbClient = Prisma.TransactionClient | PrismaService;
type SerializedWallet = ReturnType<typeof serializeWallet>;
type WalletMutationDirection = 'CREDIT' | 'DEBIT';
type WalletMutationBalanceMode =
  | 'AVAILABLE'
  | 'AVAILABLE_TO_LOCKED'
  | 'LOCKED_TO_AVAILABLE'
  | 'LOCKED_ONLY';

interface WalletLedgerMeta {
  type: WalletTransactionType;
  referenceType: string;
  referenceId: string;
  description?: string;
}

interface ApplyWalletMutationParams extends WalletLedgerMeta {
  userId: string;
  amount: Prisma.Decimal;
  direction: WalletMutationDirection;
  balanceMode?: WalletMutationBalanceMode;
}

interface WalletMutationResult {
  applied: boolean;
  ledgerId: string;
  wallet: WalletRecord;
}

const ZERO_DECIMAL = new Prisma.Decimal(0);

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyWallet(userId: string) {
    return this.getSerializedWallet(userId);
  }

  async getSerializedWallet(userId: string) {
    const [wallet, registeredCartelasCount] = await Promise.all([
      this.prisma.wallet.findUnique({
        where: { userId },
        select: walletSelect,
      }),
      this.prisma.gameCartela.count({
        where: {
          userId,
          status: {
            in: [
              GameCartelaStatus.REGISTERED,
              GameCartelaStatus.WINNER,
              GameCartelaStatus.BLOCKED,
              GameCartelaStatus.CANCELLED,
            ],
          },
        },
      }),
    ]);

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return serializeWallet(wallet, {
      isFirstTimePlayer: registeredCartelasCount === 0,
    });
  }

  async getMyTransactions(userId: string, paginationQuery: PaginationQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(paginationQuery);
    const where = { userId };
    const [totalItems, transactions] = await Promise.all([
      this.prisma.walletTransaction.count({ where }),
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: walletTransactionSelect,
      }),
    ]);

    return {
      items: transactions.map(serializeWalletTransaction),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  async getWalletOrThrow(db: PrismaDbClient, userId: string) {
    const wallet = await db.wallet.findUnique({
      where: { userId },
      select: walletSelect,
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return wallet;
  }

  async applyWalletMutation(
    db: PrismaDbClient,
    params: ApplyWalletMutationParams,
  ): Promise<WalletMutationResult> {
    this.assertPositiveAmount(params.amount);
    this.assertIdempotencyKey(params);

    const existingLedger = await this.findExistingLedgerEntry(
      db,
      params.userId,
      params,
    );

    if (existingLedger) {
      return {
        applied: false,
        ledgerId: existingLedger.id,
        wallet: await this.getWalletOrThrow(db, params.userId),
      };
    }

    const pendingLedger = await this.createPendingLedgerEntry(
      db,
      params.userId,
      params.amount,
      params,
    );

    if (!pendingLedger.created) {
      return {
        applied: false,
        ledgerId: pendingLedger.id,
        wallet: await this.getWalletOrThrow(db, params.userId),
      };
    }

    try {
      const wallet = await this.mutateWalletBalances(
        db,
        params.userId,
        params.amount,
        params.direction,
        params.balanceMode ?? 'AVAILABLE',
      );
      const { balanceBefore, balanceAfter } = this.resolveLedgerBalances(
        wallet,
        params.amount,
        params.direction,
        params.balanceMode ?? 'AVAILABLE',
      );

      await db.walletTransaction.update({
        where: { id: pendingLedger.id },
        data: {
          balanceBefore,
          balanceAfter,
        },
      });

      return {
        applied: true,
        ledgerId: pendingLedger.id,
        wallet,
      };
    } catch (error) {
      await this.deletePendingLedgerEntry(db, pendingLedger.id);
      throw error;
    }
  }

  async creditWallet(
    db: PrismaDbClient,
    userId: string,
    amount: Prisma.Decimal,
    meta: WalletLedgerMeta,
  ): Promise<string> {
    const result = await this.applyWalletMutation(db, {
      ...meta,
      userId,
      amount,
      direction: 'CREDIT',
      balanceMode: 'AVAILABLE',
    });

    return result.ledgerId;
  }

  async consumeBonusCartela(
    db: PrismaDbClient,
    userId: string,
  ): Promise<WalletRecord> {
    const updateResult = await db.wallet.updateMany({
      where: {
        userId,
        bonusCartelaBalance: { gte: 1 },
      },
      data: {
        bonusCartelaBalance: { decrement: 1 },
      },
    });

    if (updateResult.count !== 1) {
      await this.throwMutationPreconditionError(
        db,
        userId,
        'Insufficient bonus cartela balance',
      );
    }

    return this.getWalletOrThrow(db, userId);
  }

  async creditBonusCartelas(
    db: PrismaDbClient,
    userId: string,
    count: number,
  ): Promise<WalletRecord> {
    if (count <= 0) {
      return this.getWalletOrThrow(db, userId);
    }

    await db.wallet.update({
      where: { userId },
      data: {
        bonusCartelaBalance: { increment: count },
      },
    });

    return this.getWalletOrThrow(db, userId);
  }

  async debitWallet(
    db: PrismaDbClient,
    userId: string,
    amount: Prisma.Decimal,
    meta: WalletLedgerMeta,
  ): Promise<SerializedWallet> {
    const result = await this.applyWalletMutation(db, {
      ...meta,
      userId,
      amount,
      direction: 'DEBIT',
      balanceMode: 'AVAILABLE',
    });

    return serializeWallet(result.wallet);
  }

  async moveBalanceToLocked(
    db: PrismaDbClient,
    userId: string,
    amount: Prisma.Decimal,
    meta: WalletLedgerMeta,
  ): Promise<SerializedWallet> {
    const result = await this.applyWalletMutation(db, {
      ...meta,
      userId,
      amount,
      direction: 'DEBIT',
      balanceMode: 'AVAILABLE_TO_LOCKED',
    });

    return serializeWallet(result.wallet);
  }

  async releaseLockedFunds(
    db: PrismaDbClient,
    userId: string,
    amount: Prisma.Decimal,
    meta: WalletLedgerMeta,
  ): Promise<SerializedWallet> {
    const result = await this.applyWalletMutation(db, {
      ...meta,
      userId,
      amount,
      direction: 'CREDIT',
      balanceMode: 'LOCKED_TO_AVAILABLE',
    });

    return serializeWallet(result.wallet);
  }

  async consumeLockedFunds(
    db: PrismaDbClient,
    userId: string,
    amount: Prisma.Decimal,
    meta: WalletLedgerMeta,
  ): Promise<SerializedWallet> {
    const result = await this.applyWalletMutation(db, {
      ...meta,
      userId,
      amount,
      direction: 'DEBIT',
      balanceMode: 'LOCKED_ONLY',
    });

    return serializeWallet(result.wallet);
  }

  private async mutateWalletBalances(
    db: PrismaDbClient,
    userId: string,
    amount: Prisma.Decimal,
    direction: WalletMutationDirection,
    balanceMode: WalletMutationBalanceMode,
  ) {
    const plan = this.resolveMutationPlan(amount, direction, balanceMode);
    const updateResult = await db.wallet.updateMany({
      where: {
        userId,
        ...(plan.minimumAvailableBalance
          ? { balance: { gte: plan.minimumAvailableBalance } }
          : {}),
        ...(plan.minimumLockedBalance
          ? { lockedBalance: { gte: plan.minimumLockedBalance } }
          : {}),
      },
      data: plan.data,
    });

    if (updateResult.count !== 1) {
      await this.throwMutationPreconditionError(
        db,
        userId,
        plan.insufficientBalanceMessage,
      );
    }

    return this.getWalletOrThrow(db, userId);
  }

  private resolveMutationPlan(
    amount: Prisma.Decimal,
    direction: WalletMutationDirection,
    balanceMode: WalletMutationBalanceMode,
  ): {
    data: Prisma.WalletUpdateManyMutationInput;
    minimumAvailableBalance?: Prisma.Decimal;
    minimumLockedBalance?: Prisma.Decimal;
    insufficientBalanceMessage: string;
  } {
    switch (balanceMode) {
      case 'AVAILABLE':
        return direction === 'CREDIT'
          ? {
              data: { balance: { increment: amount } },
              insufficientBalanceMessage: 'Insufficient wallet balance',
            }
          : {
              data: { balance: { decrement: amount } },
              minimumAvailableBalance: amount,
              insufficientBalanceMessage: 'Insufficient wallet balance',
            };
      case 'AVAILABLE_TO_LOCKED':
        if (direction !== 'DEBIT') {
          throw new BadRequestException(
            'Locked fund reservation must debit available balance',
          );
        }

        return {
          data: {
            balance: { decrement: amount },
            lockedBalance: { increment: amount },
          },
          minimumAvailableBalance: amount,
          insufficientBalanceMessage: 'Insufficient wallet balance',
        };
      case 'LOCKED_TO_AVAILABLE':
        if (direction !== 'CREDIT') {
          throw new BadRequestException(
            'Locked fund release must credit available balance',
          );
        }

        return {
          data: {
            balance: { increment: amount },
            lockedBalance: { decrement: amount },
          },
          minimumLockedBalance: amount,
          insufficientBalanceMessage: 'Locked balance is insufficient',
        };
      case 'LOCKED_ONLY':
        if (direction !== 'DEBIT') {
          throw new BadRequestException(
            'Locked fund consumption must debit locked balance',
          );
        }

        return {
          data: {
            lockedBalance: { decrement: amount },
          },
          minimumLockedBalance: amount,
          insufficientBalanceMessage: 'Locked balance is insufficient',
        };
    }
  }

  private resolveLedgerBalances(
    wallet: WalletRecord,
    amount: Prisma.Decimal,
    direction: WalletMutationDirection,
    balanceMode: WalletMutationBalanceMode,
  ) {
    switch (balanceMode) {
      case 'AVAILABLE':
        return direction === 'CREDIT'
          ? {
              balanceBefore: wallet.balance.minus(amount),
              balanceAfter: wallet.balance,
            }
          : {
              balanceBefore: wallet.balance.plus(amount),
              balanceAfter: wallet.balance,
            };
      case 'AVAILABLE_TO_LOCKED':
        return {
          balanceBefore: wallet.balance.plus(amount),
          balanceAfter: wallet.balance,
        };
      case 'LOCKED_TO_AVAILABLE':
        return {
          balanceBefore: wallet.balance.minus(amount),
          balanceAfter: wallet.balance,
        };
      case 'LOCKED_ONLY':
        return {
          balanceBefore: wallet.balance,
          balanceAfter: wallet.balance,
        };
    }
  }

  private async throwMutationPreconditionError(
    db: PrismaDbClient,
    userId: string,
    insufficientBalanceMessage: string,
  ): Promise<never> {
    const wallet = await db.wallet.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    throw new BadRequestException(insufficientBalanceMessage);
  }

  private async findExistingLedgerEntry(
    db: PrismaDbClient,
    userId: string,
    meta: WalletLedgerMeta,
  ) {
    return db.walletTransaction.findUnique({
      where: {
        userId_type_referenceType_referenceId: {
          userId,
          type: meta.type,
          referenceType: meta.referenceType,
          referenceId: meta.referenceId,
        },
      },
      select: { id: true },
    });
  }

  private async createPendingLedgerEntry(
    db: PrismaDbClient,
    userId: string,
    amount: Prisma.Decimal,
    meta: WalletLedgerMeta,
  ): Promise<{ id: string; created: boolean }> {
    try {
      const created = await db.walletTransaction.create({
        data: {
          userId,
          type: meta.type,
          amount,
          balanceBefore: ZERO_DECIMAL,
          balanceAfter: ZERO_DECIMAL,
          referenceType: meta.referenceType,
          referenceId: meta.referenceId,
          description: meta.description,
        },
        select: { id: true },
      });

      return { id: created.id, created: true };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const existing = await this.findExistingLedgerEntry(db, userId, meta);
        if (existing) {
          return { id: existing.id, created: false };
        }
      }

      throw error;
    }
  }

  private async deletePendingLedgerEntry(db: PrismaDbClient, ledgerId: string) {
    try {
      await db.walletTransaction.delete({
        where: { id: ledgerId },
      });
    } catch {
      // Best effort cleanup inside the caller transaction.
    }
  }

  private assertPositiveAmount(amount: Prisma.Decimal) {
    if (amount.lte(0)) {
      throw new BadRequestException('Amount must be greater than zero');
    }
  }

  private assertIdempotencyKey(meta: WalletLedgerMeta) {
    if (!meta.referenceType?.trim() || !meta.referenceId?.trim()) {
      throw new BadRequestException(
        'Wallet mutation requires referenceType and referenceId',
      );
    }
  }

  private isUniqueConstraintError(error: unknown): error is { code: string } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string' &&
      error.code === 'P2002'
    );
  }
}
