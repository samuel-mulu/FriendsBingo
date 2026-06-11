import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WalletTransactionType } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import {
  buildPaginationMeta,
  getPaginationParams,
} from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import { serializeWallet, serializeWalletTransaction } from './wallet.mapper';
import { walletSelect, walletTransactionSelect } from './wallet.select';

type PrismaDbClient = Prisma.TransactionClient | PrismaService;

interface WalletLedgerMeta {
  type: WalletTransactionType;
  referenceType?: string;
  referenceId?: string;
  description?: string;
}

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyWallet(userId: string) {
    return this.getSerializedWallet(userId);
  }

  async getSerializedWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: walletSelect,
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return serializeWallet(wallet);
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

  async creditWallet(
    db: PrismaDbClient,
    userId: string,
    amount: Prisma.Decimal,
    meta: WalletLedgerMeta,
  ) {
    if (await this.hasExistingLedgerEntry(db, userId, meta)) {
      return;
    }

    const wallet = await this.getWalletOrThrow(db, userId);
    const newBalance = wallet.balance.plus(amount);

    await db.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: newBalance,
      },
    });

    await this.createWalletTransaction(
      db,
      userId,
      amount,
      wallet.balance,
      newBalance,
      meta,
    );
  }

  async debitWallet(
    db: PrismaDbClient,
    userId: string,
    amount: Prisma.Decimal,
    meta: WalletLedgerMeta,
  ): Promise<ReturnType<typeof serializeWallet> | null> {
    if (await this.hasExistingLedgerEntry(db, userId, meta)) {
      return null;
    }

    const wallet = await this.getWalletOrThrow(db, userId);

    if (wallet.balance.lt(amount)) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    const newBalance = wallet.balance.minus(amount);

    await db.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: newBalance,
      },
    });

    await this.createWalletTransaction(
      db,
      userId,
      amount,
      wallet.balance,
      newBalance,
      meta,
    );

    return serializeWallet({
      ...wallet,
      balance: newBalance,
      updatedAt: new Date(),
    });
  }

  async moveBalanceToLocked(
    db: PrismaDbClient,
    userId: string,
    amount: Prisma.Decimal,
    meta: WalletLedgerMeta,
  ) {
    const wallet = await this.getWalletOrThrow(db, userId);

    if (wallet.balance.lt(amount)) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    const newBalance = wallet.balance.minus(amount);
    const newLockedBalance = wallet.lockedBalance.plus(amount);

    await db.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: newBalance,
        lockedBalance: newLockedBalance,
      },
    });

    await this.createWalletTransaction(
      db,
      userId,
      amount,
      wallet.balance,
      newBalance,
      meta,
    );
  }

  async releaseLockedFunds(
    db: PrismaDbClient,
    userId: string,
    amount: Prisma.Decimal,
    meta: WalletLedgerMeta,
  ) {
    const wallet = await this.getWalletOrThrow(db, userId);

    if (wallet.lockedBalance.lt(amount)) {
      throw new BadRequestException('Locked balance is insufficient');
    }

    const newBalance = wallet.balance.plus(amount);
    const newLockedBalance = wallet.lockedBalance.minus(amount);

    await db.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: newBalance,
        lockedBalance: newLockedBalance,
      },
    });

    await this.createWalletTransaction(
      db,
      userId,
      amount,
      wallet.balance,
      newBalance,
      meta,
    );
  }

  async consumeLockedFunds(
    db: PrismaDbClient,
    userId: string,
    amount: Prisma.Decimal,
    meta: WalletLedgerMeta,
  ) {
    const wallet = await this.getWalletOrThrow(db, userId);

    if (wallet.lockedBalance.lt(amount)) {
      throw new BadRequestException('Locked balance is insufficient');
    }

    const newLockedBalance = wallet.lockedBalance.minus(amount);

    await db.wallet.update({
      where: { id: wallet.id },
      data: {
        lockedBalance: newLockedBalance,
      },
    });

    await this.createWalletTransaction(
      db,
      userId,
      amount,
      wallet.balance,
      wallet.balance,
      meta,
    );
  }

  private async hasExistingLedgerEntry(
    db: PrismaDbClient,
    userId: string,
    meta: WalletLedgerMeta,
  ) {
    if (!meta.referenceType || !meta.referenceId) {
      return false;
    }

    const existing = await db.walletTransaction.findUnique({
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

    return existing !== null;
  }

  private async createWalletTransaction(
    db: PrismaDbClient,
    userId: string,
    amount: Prisma.Decimal,
    balanceBefore: Prisma.Decimal,
    balanceAfter: Prisma.Decimal,
    meta: WalletLedgerMeta,
  ) {
    try {
      await db.walletTransaction.create({
        data: {
          userId,
          type: meta.type,
          amount,
          balanceBefore,
          balanceAfter,
          referenceType: meta.referenceType,
          referenceId: meta.referenceId,
          description: meta.description,
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        return;
      }

      throw error;
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
