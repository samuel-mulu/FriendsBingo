import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DepositStatus,
  Prisma,
  WalletTransactionType,
  WithdrawStatus,
} from '@prisma/client';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import {
  buildPaginationMeta,
  getPaginationParams,
} from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import { serializeDeposit } from '../deposits/deposits.mapper';
import { depositSelect } from '../deposits/deposits.select';
import { serializeWithdrawal } from '../withdrawals/withdrawals.mapper';
import { withdrawalSelect } from '../withdrawals/withdrawals.select';
import {
  serializeWallet,
  serializeWalletTransaction,
} from '../wallet/wallet.mapper';
import { walletTransactionSelect } from '../wallet/wallet.select';
import {
  serializeAdminUserDetail,
  serializeAdminUserListItem,
  serializeUser,
} from './users.mapper';
import {
  adminUserDetailSelect,
  adminUserListSelect,
  userProfileSelect,
  type AdminUserListRecord,
} from './users.select';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userProfileSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return serializeUser(user);
  }

  async getAdminUsers(paginationQuery: AdminUsersQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(paginationQuery);
    const search = paginationQuery.search?.trim();
    const sortBy = paginationQuery.sortBy ?? 'balance';
    const sortOrder = paginationQuery.sortOrder ?? 'desc';

    const where: Prisma.UserWhereInput = {
      ...(paginationQuery.role ? { role: paginationQuery.role } : {}),
      ...(search
        ? {
            OR: [
              {
                fullName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                phoneNumber: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const totalItems = await this.prisma.user.count({ where });

    let users: AdminUserListRecord[];

    if (sortBy === 'balance') {
      // Prisma optional-relation orderBy is unreliable for wallet balance.
      // Sort explicitly by Wallet.balance so the table matches richest-first.
      const conditions: Prisma.Sql[] = [];
      if (paginationQuery.role) {
        conditions.push(
          Prisma.sql`u.role = CAST(${paginationQuery.role} AS "UserRole")`,
        );
      }
      if (search) {
        const pattern = `%${search}%`;
        conditions.push(
          Prisma.sql`(u."fullName" ILIKE ${pattern} OR u."phoneNumber" ILIKE ${pattern})`,
        );
      }
      const whereSql =
        conditions.length > 0
          ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
          : Prisma.empty;
      const orderSql =
        sortOrder === 'asc'
          ? Prisma.sql`ORDER BY COALESCE(w.balance, 0) ASC, u."createdAt" DESC`
          : Prisma.sql`ORDER BY COALESCE(w.balance, 0) DESC, u."createdAt" DESC`;

      const ranked = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT u.id
        FROM "User" u
        LEFT JOIN "Wallet" w ON w."userId" = u.id
        ${whereSql}
        ${orderSql}
        LIMIT ${take} OFFSET ${skip}
      `;

      const orderedIds = ranked.map((row) => row.id);
      if (orderedIds.length === 0) {
        users = [];
      } else {
        const fetched = await this.prisma.user.findMany({
          where: { id: { in: orderedIds } },
          select: adminUserListSelect,
        });
        const byId = new Map(fetched.map((user) => [user.id, user]));
        users = orderedIds
          .map((id) => byId.get(id))
          .filter((user): user is AdminUserListRecord => Boolean(user));
      }
    } else {
      users = await this.prisma.user.findMany({
        where,
        orderBy: { createdAt: sortOrder },
        skip,
        take,
        select: adminUserListSelect,
      });
    }

    return {
      items: users.map(serializeAdminUserListItem),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  async assertUserExists(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
  }

  async getAdminUserWalletTransactions(
    userId: string,
    paginationQuery: PaginationQueryDto,
  ) {
    await this.assertUserExists(userId);

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

  async getAdminUserById(userId: string) {
    const [user, winnerCartelas] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: adminUserDetailSelect,
      }),
      this.prisma.gameCartela.count({
        where: { userId, isWinner: true },
      }),
    ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return serializeAdminUserDetail(user, winnerCartelas);
  }

  /** Security review payload for withdrawal approval. */
  async getAdminUserFinancialHistory(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: adminUserDetailSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [
      winnerCartelas,
      deposits,
      withdrawals,
      transactions,
      approvedDepositsAgg,
      paidWithdrawalsAgg,
      prizeWinsAgg,
      gameEntryAgg,
      pendingWithdrawalsAgg,
    ] = await Promise.all([
      this.prisma.gameCartela.count({
        where: { userId, isWinner: true },
      }),
      this.prisma.deposit.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: depositSelect,
      }),
      this.prisma.withdrawal.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: withdrawalSelect,
      }),
      this.prisma.walletTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: walletTransactionSelect,
      }),
      this.prisma.deposit.aggregate({
        where: { userId, status: DepositStatus.APPROVED },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.withdrawal.aggregate({
        where: { userId, status: WithdrawStatus.PAID },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { userId, type: WalletTransactionType.PRIZE_WIN },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { userId, type: WalletTransactionType.GAME_ENTRY },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.withdrawal.aggregate({
        where: { userId, status: WithdrawStatus.PENDING },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const totalDeposited =
      approvedDepositsAgg._sum.amount ?? new Prisma.Decimal(0);
    const totalWithdrawn =
      paidWithdrawalsAgg._sum.amount ?? new Prisma.Decimal(0);
    const totalPrizeWon = prizeWinsAgg._sum.amount ?? new Prisma.Decimal(0);
    const totalGameEntry = gameEntryAgg._sum.amount ?? new Prisma.Decimal(0);
    const pendingWithdrawalTotal =
      pendingWithdrawalsAgg._sum.amount ?? new Prisma.Decimal(0);

    return {
      user: serializeAdminUserDetail(user, winnerCartelas),
      wallet: user.wallet ? serializeWallet(user.wallet) : null,
      summary: {
        totalDeposited: totalDeposited.toString(),
        approvedDepositCount: approvedDepositsAgg._count._all,
        totalWithdrawn: totalWithdrawn.toString(),
        paidWithdrawalCount: paidWithdrawalsAgg._count._all,
        totalPrizeWon: totalPrizeWon.toString(),
        prizeWinCount: prizeWinsAgg._count._all,
        totalGameEntry: totalGameEntry.toString(),
        gameEntryCount: gameEntryAgg._count._all,
        pendingWithdrawalTotal: pendingWithdrawalTotal.toString(),
        pendingWithdrawalCount: pendingWithdrawalsAgg._count._all,
      },
      deposits: deposits.map(serializeDeposit),
      withdrawals: withdrawals.map(serializeWithdrawal),
      transactions: transactions.map(serializeWalletTransaction),
    };
  }
}
