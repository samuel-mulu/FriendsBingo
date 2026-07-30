import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DepositStatus,
  Prisma,
  WalletTransactionType,
  WithdrawStatus,
} from '@prisma/client';
import { AdminDevicesQueryDto } from './dto/admin-devices-query.dto';
import {
  AdminUserWalletTransactionsQueryDto,
  AdminWalletTransactionCategory,
} from './dto/admin-user-wallet-transactions-query.dto';
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

type DeviceAggRow = {
  device_id: string;
  account_count: number;
  user_ids: string[];
};

type DeviceSummaryRow = {
  total_devices: number;
  duplicate_devices: number;
};

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

  private readonly withdrawalWalletTypes: WalletTransactionType[] = [
    WalletTransactionType.WITHDRAW_REQUEST,
    WalletTransactionType.WITHDRAW_PAID,
    WalletTransactionType.WITHDRAW_REFUND,
  ];

  private readonly gameWalletTypes: WalletTransactionType[] = [
    WalletTransactionType.GAME_ENTRY,
    WalletTransactionType.REFUND,
  ];

  async getAdminUserWalletTransactions(
    userId: string,
    query: AdminUserWalletTransactionsQueryDto,
  ) {
    await this.assertUserExists(userId);

    const { page, pageSize, skip, take } = getPaginationParams(query);
    const where = await this.buildAdminWalletTransactionWhere(userId, query);
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
      items: await this.serializeAdminWalletTransactions(transactions),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  private async buildAdminWalletTransactionWhere(
    userId: string,
    query: AdminUserWalletTransactionsQueryDto,
  ): Promise<Prisma.WalletTransactionWhereInput> {
    const category = query.category ?? AdminWalletTransactionCategory.ALL;
    const where: Prisma.WalletTransactionWhereInput = { userId };

    switch (category) {
      case AdminWalletTransactionCategory.DEPOSIT:
        where.type = WalletTransactionType.DEPOSIT;
        break;
      case AdminWalletTransactionCategory.WITHDRAWAL:
        where.type = { in: this.withdrawalWalletTypes };
        break;
      case AdminWalletTransactionCategory.GAME:
        where.type = { in: this.gameWalletTypes };
        break;
      case AdminWalletTransactionCategory.PRIZE:
        where.type = WalletTransactionType.PRIZE_WIN;
        break;
      case AdminWalletTransactionCategory.OTHER:
        where.type = WalletTransactionType.ADMIN_ADJUSTMENT;
        break;
      default:
        break;
    }

    if (!query.status) {
      return where;
    }

    const statusApplies =
      category === AdminWalletTransactionCategory.ALL ||
      category === AdminWalletTransactionCategory.DEPOSIT ||
      category === AdminWalletTransactionCategory.WITHDRAWAL;

    if (!statusApplies) {
      return where;
    }

    const referenceFilter = await this.buildWalletTransactionReferenceStatusFilter(
      userId,
      query.status,
      category,
    );

    return {
      AND: [where, referenceFilter],
    };
  }

  private async buildWalletTransactionReferenceStatusFilter(
    userId: string,
    status: string,
    category: AdminWalletTransactionCategory,
  ): Promise<Prisma.WalletTransactionWhereInput> {
    const orConditions: Prisma.WalletTransactionWhereInput[] = [];
    const depositStatuses = new Set<string>(Object.values(DepositStatus));
    const withdrawalStatuses = new Set<string>(Object.values(WithdrawStatus));

    const includeDeposits =
      category === AdminWalletTransactionCategory.ALL ||
      category === AdminWalletTransactionCategory.DEPOSIT;
    const includeWithdrawals =
      category === AdminWalletTransactionCategory.ALL ||
      category === AdminWalletTransactionCategory.WITHDRAWAL;

    if (includeDeposits && depositStatuses.has(status)) {
      const deposits = await this.prisma.deposit.findMany({
        where: { userId, status: status as DepositStatus },
        select: { id: true },
      });
      if (deposits.length > 0) {
        orConditions.push({
          type: WalletTransactionType.DEPOSIT,
          referenceType: 'deposit',
          referenceId: { in: deposits.map((deposit) => deposit.id) },
        });
      }
    }

    if (includeWithdrawals && withdrawalStatuses.has(status)) {
      const withdrawals = await this.prisma.withdrawal.findMany({
        where: { userId, status: status as WithdrawStatus },
        select: { id: true },
      });
      if (withdrawals.length > 0) {
        orConditions.push({
          type: { in: this.withdrawalWalletTypes },
          referenceType: 'withdrawal',
          referenceId: { in: withdrawals.map((withdrawal) => withdrawal.id) },
        });
      }
    }

    if (orConditions.length === 0) {
      return { id: { in: [] } };
    }

    return { OR: orConditions };
  }

  private async serializeAdminWalletTransactions(
    transactions: Array<
      Prisma.WalletTransactionGetPayload<{
        select: typeof walletTransactionSelect;
      }>
    >,
  ) {
    const depositIds = transactions
      .filter(
        (transaction) =>
          transaction.referenceType === 'deposit' && transaction.referenceId,
      )
      .map((transaction) => transaction.referenceId as string);
    const withdrawalIds = transactions
      .filter(
        (transaction) =>
          transaction.referenceType === 'withdrawal' && transaction.referenceId,
      )
      .map((transaction) => transaction.referenceId as string);

    const [deposits, withdrawals] = await Promise.all([
      depositIds.length > 0
        ? this.prisma.deposit.findMany({
            where: { id: { in: depositIds } },
            select: { id: true, status: true },
          })
        : Promise.resolve([]),
      withdrawalIds.length > 0
        ? this.prisma.withdrawal.findMany({
            where: { id: { in: withdrawalIds } },
            select: { id: true, status: true },
          })
        : Promise.resolve([]),
    ]);

    const depositStatusById = new Map<string, DepositStatus>(
      deposits.map(
        (deposit): [string, DepositStatus] => [deposit.id, deposit.status],
      ),
    );
    const withdrawalStatusById = new Map<string, WithdrawStatus>(
      withdrawals.map(
        (withdrawal): [string, WithdrawStatus] => [
          withdrawal.id,
          withdrawal.status,
        ],
      ),
    );

    return transactions.map((transaction) => {
      const referenceStatus =
        transaction.referenceType === 'deposit' && transaction.referenceId
          ? (depositStatusById.get(transaction.referenceId) ?? null)
          : transaction.referenceType === 'withdrawal' && transaction.referenceId
            ? (withdrawalStatusById.get(transaction.referenceId) ?? null)
            : null;

      return {
        ...serializeWalletTransaction(transaction),
        referenceStatus,
      };
    });
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

  async getAdminDevices(query: AdminDevicesQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(query);
    const search = query.search?.trim() || null;
    const duplicatesOnly = query.duplicatesOnly === true;
    const searchPattern = search ? `%${search}%` : null;

    const [summaryRows, deviceRows] = await Promise.all([
      this.prisma.$queryRaw<DeviceSummaryRow[]>`
        WITH linked AS (
          SELECT DISTINCT rt."deviceId" AS device_id, rt."userId" AS user_id
          FROM "RefreshToken" rt
          WHERE rt."deviceId" IS NOT NULL AND btrim(rt."deviceId") <> ''
          UNION
          SELECT g."deviceId", g."userId"
          FROM "DeviceWelcomeBonusGrant" g
        ),
        agg AS (
          SELECT
            linked.device_id,
            COUNT(*)::int AS account_count
          FROM linked
          GROUP BY linked.device_id
        )
        SELECT
          COUNT(*)::int AS total_devices,
          COUNT(*) FILTER (WHERE agg.account_count > 1)::int AS duplicate_devices
        FROM agg
      `,
      this.prisma.$queryRaw<DeviceAggRow[]>`
        WITH linked AS (
          SELECT DISTINCT rt."deviceId" AS device_id, rt."userId" AS user_id
          FROM "RefreshToken" rt
          WHERE rt."deviceId" IS NOT NULL AND btrim(rt."deviceId") <> ''
          UNION
          SELECT g."deviceId", g."userId"
          FROM "DeviceWelcomeBonusGrant" g
        ),
        agg AS (
          SELECT
            linked.device_id,
            COUNT(*)::int AS account_count,
            ARRAY_AGG(linked.user_id ORDER BY linked.user_id) AS user_ids
          FROM linked
          GROUP BY linked.device_id
        )
        SELECT
          agg.device_id,
          agg.account_count,
          agg.user_ids
        FROM agg
        WHERE
          (${duplicatesOnly} = false OR agg.account_count > 1)
          AND (
            ${searchPattern}::text IS NULL
            OR agg.device_id ILIKE ${searchPattern}
            OR EXISTS (
              SELECT 1
              FROM "User" u
              WHERE u.id = ANY(agg.user_ids)
                AND (
                  u."phoneNumber" ILIKE ${searchPattern}
                  OR u."fullName" ILIKE ${searchPattern}
                )
            )
          )
        ORDER BY agg.account_count DESC, agg.device_id ASC
        LIMIT ${take} OFFSET ${skip}
      `,
    ]);

    const filteredCountRows = await this.prisma.$queryRaw<
      Array<{ total_items: number }>
    >`
      WITH linked AS (
        SELECT DISTINCT rt."deviceId" AS device_id, rt."userId" AS user_id
        FROM "RefreshToken" rt
        WHERE rt."deviceId" IS NOT NULL AND btrim(rt."deviceId") <> ''
        UNION
        SELECT g."deviceId", g."userId"
        FROM "DeviceWelcomeBonusGrant" g
      ),
      agg AS (
        SELECT
          linked.device_id,
          COUNT(*)::int AS account_count,
          ARRAY_AGG(linked.user_id ORDER BY linked.user_id) AS user_ids
        FROM linked
        GROUP BY linked.device_id
      )
      SELECT COUNT(*)::int AS total_items
      FROM agg
      WHERE
        (${duplicatesOnly} = false OR agg.account_count > 1)
        AND (
          ${searchPattern}::text IS NULL
          OR agg.device_id ILIKE ${searchPattern}
          OR EXISTS (
            SELECT 1
            FROM "User" u
            WHERE u.id = ANY(agg.user_ids)
              AND (
                u."phoneNumber" ILIKE ${searchPattern}
                OR u."fullName" ILIKE ${searchPattern}
              )
          )
        )
    `;

    const userIds = Array.from(
      new Set(deviceRows.flatMap((row) => row.user_ids)),
    );
    const deviceIds = deviceRows.map((row) => row.device_id);

    type DeviceUserRow = {
      id: string;
      fullName: string;
      phoneNumber: string;
      status: 'ACTIVE' | 'BLOCKED';
    };
    type DeviceGrantRow = {
      deviceId: string;
      phoneNumber: string;
      bonusAmount: number;
      createdAt: Date;
      userId: string;
    };
    type DeviceLastSeenRow = {
      device_id: string;
      last_seen_at: Date | null;
    };

    let users: DeviceUserRow[] = [];
    let grants: DeviceGrantRow[] = [];
    let lastSeenRows: DeviceLastSeenRow[] = [];

    if (userIds.length > 0) {
      users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          fullName: true,
          phoneNumber: true,
          status: true,
        },
      });
    }

    if (deviceIds.length > 0) {
      [grants, lastSeenRows] = await Promise.all([
        this.prisma.deviceWelcomeBonusGrant.findMany({
          where: { deviceId: { in: deviceIds } },
          select: {
            deviceId: true,
            phoneNumber: true,
            bonusAmount: true,
            createdAt: true,
            userId: true,
          },
        }),
        this.prisma.$queryRaw<DeviceLastSeenRow[]>`
          SELECT
            rt."deviceId" AS device_id,
            MAX(rt."updatedAt") AS last_seen_at
          FROM "RefreshToken" rt
          WHERE rt."deviceId" IN (${Prisma.join(deviceIds)})
          GROUP BY rt."deviceId"
        `,
      ]);
    }

    const usersById = new Map(users.map((user) => [user.id, user] as const));
    // Prefer the positive award when a device also has denial (0) rows.
    const grantByDeviceId = new Map<string, DeviceGrantRow>();
    for (const grant of grants) {
      const existing = grantByDeviceId.get(grant.deviceId);
      if (!existing || grant.bonusAmount > existing.bonusAmount) {
        grantByDeviceId.set(grant.deviceId, grant);
      }
    }
    const lastSeenByDeviceId = new Map(
      lastSeenRows.map((row) => [row.device_id, row.last_seen_at] as const),
    );

    const summary = summaryRows[0] ?? {
      total_devices: 0,
      duplicate_devices: 0,
    };

    const items = deviceRows.map((row) => {
      const accounts = row.user_ids
        .map((userId) => usersById.get(userId))
        .filter((user): user is NonNullable<typeof user> => Boolean(user))
        .map((user) => ({
          userId: user.id,
          fullName: user.fullName,
          phoneNumber: user.phoneNumber,
          status: user.status,
        }));

      const grant = grantByDeviceId.get(row.device_id) ?? null;
      const awardedGrant = grant && grant.bonusAmount > 0 ? grant : null;
      const isDuplicate = row.account_count > 1;
      const recommendationCode = isDuplicate
        ? 'REVIEW_MULTI_ACCOUNT'
        : awardedGrant
          ? 'NORMAL'
          : 'NORMAL_NO_BONUS';
      const recommendation = isDuplicate
        ? 'Review — multiple phone numbers used this device. Welcome bonus is only granted once per device.'
        : awardedGrant
          ? 'Normal — single account. Welcome bonus already claimed on this device.'
          : 'Normal — single account. No welcome-bonus grant recorded for this device.';

      return {
        deviceId: row.device_id,
        accountCount: row.account_count,
        isDuplicate,
        phoneNumbers: accounts.map((account) => account.phoneNumber),
        accounts,
        welcomeBonus: awardedGrant
          ? {
              granted: true,
              phoneNumber: awardedGrant.phoneNumber,
              userId: awardedGrant.userId,
              bonusAmount: awardedGrant.bonusAmount,
              grantedAt: awardedGrant.createdAt.toISOString(),
            }
          : {
              granted: false,
              phoneNumber: null,
              userId: null,
              bonusAmount: null,
              grantedAt: null,
            },
        recommendationCode,
        recommendation,
        lastSeenAt:
          lastSeenByDeviceId.get(row.device_id)?.toISOString() ?? null,
      };
    });

    return {
      items,
      pagination: buildPaginationMeta(
        page,
        pageSize,
        filteredCountRows[0]?.total_items ?? 0,
      ),
      summary: {
        totalDevices: summary.total_devices,
        duplicateDevices: summary.duplicate_devices,
      },
    };
  }
}
