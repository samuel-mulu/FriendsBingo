import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DepositStatus,
  GameStatus,
  Prisma,
  UserRole,
  UserStatus,
  WalletTransactionType,
  WithdrawStatus,
} from '@prisma/client';
import { DateRangeQueryDto } from './dto/date-range-query.dto';
import { PrismaService } from '../prisma/prisma.service';

type AmountRecord = {
  amount: Prisma.Decimal;
  occurredAt: Date;
};

@Injectable()
export class AdminReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    const todayRange = this.createTodayRange();

    const [
      totalPlayers,
      activePlayers,
      blockedPlayers,
      totalGames,
      activeGames,
      finishedGamesToday,
      pendingDeposits,
      pendingWithdrawals,
      depositsToday,
      withdrawalsToday,
      gameEntryToday,
      prizePaidToday,
    ] = await Promise.all([
      this.prisma.user.count({
        where: { role: UserRole.PLAYER },
      }),
      this.prisma.user.count({
        where: {
          role: UserRole.PLAYER,
          status: UserStatus.ACTIVE,
        },
      }),
      this.prisma.user.count({
        where: {
          role: UserRole.PLAYER,
          status: UserStatus.BLOCKED,
        },
      }),
      this.prisma.game.count(),
      this.prisma.game.count({
        where: {
          status: {
            in: [GameStatus.NEXT, GameStatus.CHECKING, GameStatus.PLAYING],
          },
        },
      }),
      this.prisma.game.count({
        where: {
          status: GameStatus.FINISHED,
          finishedAt: todayRange,
        },
      }),
      this.prisma.deposit.count({
        where: {
          status: {
            in: [
              DepositStatus.PENDING,
              DepositStatus.VERIFYING,
              DepositStatus.MANUAL_REVIEW,
            ],
          },
        },
      }),
      this.prisma.withdrawal.count({
        where: {
          status: {
            in: [WithdrawStatus.PENDING, WithdrawStatus.APPROVED],
          },
        },
      }),
      this.findApprovedDeposits(todayRange),
      this.findPaidWithdrawals(todayRange),
      this.findWalletTransactionsByType(WalletTransactionType.GAME_ENTRY, todayRange),
      this.findWalletTransactionsByType(WalletTransactionType.PRIZE_WIN, todayRange),
    ]);

    const depositsTodayTotal = this.sumAmountRecords(depositsToday);
    const withdrawalsTodayTotal = this.sumAmountRecords(withdrawalsToday);
    const gameEntryTodayTotal = this.sumAmountRecords(gameEntryToday);
    const prizePaidTodayTotal = this.sumAmountRecords(prizePaidToday);

    return {
      totalPlayers,
      activePlayers,
      blockedPlayers,
      totalGames,
      activeGames,
      finishedGamesToday,
      pendingDeposits,
      pendingWithdrawals,
      depositsTodayTotal: depositsTodayTotal.toString(),
      withdrawalsTodayTotal: withdrawalsTodayTotal.toString(),
      gameEntryTodayTotal: gameEntryTodayTotal.toString(),
      prizePaidTodayTotal: prizePaidTodayTotal.toString(),
      netToday: gameEntryTodayTotal.minus(prizePaidTodayTotal).toString(),
    };
  }

  async getFinancialReport(dateRangeQuery: DateRangeQueryDto) {
    const dateRange = this.buildDateRange(dateRangeQuery);

    const [deposits, withdrawals, gameEntries, prizes] = await Promise.all([
      this.findApprovedDeposits(dateRange),
      this.findPaidWithdrawals(dateRange),
      this.findWalletTransactionsByType(WalletTransactionType.GAME_ENTRY, dateRange),
      this.findWalletTransactionsByType(WalletTransactionType.PRIZE_WIN, dateRange),
    ]);

    const depositsTotal = this.sumAmountRecords(deposits);
    const withdrawalsTotal = this.sumAmountRecords(withdrawals);
    const gameEntryTotal = this.sumAmountRecords(gameEntries);
    const prizePaidTotal = this.sumAmountRecords(prizes);
    const groupedByDay = this.groupFinancialTotalsByDay(
      deposits,
      withdrawals,
      gameEntries,
      prizes,
      dateRangeQuery,
    );

    return {
      depositsTotal: depositsTotal.toString(),
      withdrawalsTotal: withdrawalsTotal.toString(),
      gameEntryTotal: gameEntryTotal.toString(),
      prizePaidTotal: prizePaidTotal.toString(),
      netRevenue: gameEntryTotal.minus(prizePaidTotal).toString(),
      transactionCount:
        deposits.length + withdrawals.length + gameEntries.length + prizes.length,
      dailyTotals: groupedByDay,
    };
  }

  async getGamesReport(dateRangeQuery: DateRangeQueryDto) {
    const createdAtRange = this.buildDateRange(dateRangeQuery);
    const finishedAtRange = this.buildDateRange(dateRangeQuery);

    const [createdGames, finishedGames, registrations] = await Promise.all([
      this.prisma.game.findMany({
        where: {
          createdAt: createdAtRange,
        },
        select: {
          id: true,
          prizeAmount: true,
        },
      }),
      this.prisma.game.findMany({
        where: {
          status: GameStatus.FINISHED,
          finishedAt: finishedAtRange,
        },
        select: {
          id: true,
          code: true,
          name: true,
          gameType: true,
          prizeAmount: true,
          finishedAt: true,
          winnerCartelaId: true,
        },
      }),
      this.prisma.gameCartela.findMany({
        where: {
          createdAt: createdAtRange,
        },
        select: {
          id: true,
          gameId: true,
          game: {
            select: {
              code: true,
              entryFee: true,
            },
          },
        },
      }),
    ]);

    const totalPrizeAmount = createdGames.reduce(
      (total, game) => total.plus(game.prizeAmount),
      new Prisma.Decimal(0),
    );

    const totalEntryFees = registrations.reduce(
      (total, registration) => total.plus(registration.game.entryFee),
      new Prisma.Decimal(0),
    );

    const winnerCartelaIds = finishedGames
      .map((game) => game.winnerCartelaId)
      .filter((winnerCartelaId): winnerCartelaId is string => Boolean(winnerCartelaId));

    const winnerCartelas = winnerCartelaIds.length
      ? await this.prisma.gameCartela.findMany({
          where: {
            id: { in: winnerCartelaIds },
          },
          select: {
            id: true,
            user: {
              select: {
                id: true,
                fullName: true,
                phoneNumber: true,
                role: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
            cartela: {
              select: {
                id: true,
                number: true,
              },
            },
          },
        })
      : [];

    const winnerCartelaById = new Map(
      winnerCartelas.map((winnerCartela) => [winnerCartela.id, winnerCartela]),
    );

    return {
      gamesCreated: createdGames.length,
      gamesFinished: finishedGames.length,
      totalRegistrations: registrations.length,
      totalEntryFees: totalEntryFees.toString(),
      totalPrizeAmount: totalPrizeAmount.toString(),
      averagePlayersPerGame:
        createdGames.length > 0
          ? Number((registrations.length / createdGames.length).toFixed(2))
          : 0,
      winners: finishedGames
        .filter((game) => game.winnerCartelaId)
        .map((game) => {
          const winnerCartela = winnerCartelaById.get(game.winnerCartelaId!);

          return {
            gameId: game.id,
            gameCode: game.code,
            gameName: game.name,
            gameType: game.gameType,
            finishedAt: game.finishedAt,
            prizeAmount: game.prizeAmount.toString(),
            winnerCartelaId: game.winnerCartelaId,
            winnerUser: winnerCartela?.user ?? null,
            cartelaNumber: winnerCartela?.cartela.number ?? null,
          };
        }),
    };
  }

  private async findApprovedDeposits(dateRange: Prisma.DateTimeFilter) {
    const deposits = await this.prisma.deposit.findMany({
      where: {
        status: DepositStatus.APPROVED,
        verifiedAt: dateRange,
      },
      select: {
        amount: true,
        verifiedAt: true,
      },
    });

    return deposits
      .filter((deposit): deposit is { amount: Prisma.Decimal; verifiedAt: Date } =>
        Boolean(deposit.verifiedAt),
      )
      .map((deposit) => ({
        amount: deposit.amount,
        occurredAt: deposit.verifiedAt,
      }));
  }

  private async findPaidWithdrawals(dateRange: Prisma.DateTimeFilter) {
    const withdrawals = await this.prisma.withdrawal.findMany({
      where: {
        status: WithdrawStatus.PAID,
        paidAt: dateRange,
      },
      select: {
        amount: true,
        paidAt: true,
      },
    });

    return withdrawals
      .filter(
        (withdrawal): withdrawal is { amount: Prisma.Decimal; paidAt: Date } =>
          Boolean(withdrawal.paidAt),
      )
      .map((withdrawal) => ({
        amount: withdrawal.amount,
        occurredAt: withdrawal.paidAt,
      }));
  }

  private async findWalletTransactionsByType(
    type: WalletTransactionType,
    dateRange: Prisma.DateTimeFilter,
  ) {
    const transactions = await this.prisma.walletTransaction.findMany({
      where: {
        type,
        createdAt: dateRange,
      },
      select: {
        amount: true,
        createdAt: true,
      },
    });

    return transactions.map((transaction) => ({
      amount: transaction.amount,
      occurredAt: transaction.createdAt,
    }));
  }

  private groupFinancialTotalsByDay(
    deposits: AmountRecord[],
    withdrawals: AmountRecord[],
    gameEntries: AmountRecord[],
    prizes: AmountRecord[],
    dateRangeQuery: DateRangeQueryDto,
  ) {
    const grouped = new Map<
      string,
      {
        depositsTotal: Prisma.Decimal;
        withdrawalsTotal: Prisma.Decimal;
        gameEntryTotal: Prisma.Decimal;
        prizePaidTotal: Prisma.Decimal;
      }
    >();

    const applyAmount = (
      records: AmountRecord[],
      key: 'depositsTotal' | 'withdrawalsTotal' | 'gameEntryTotal' | 'prizePaidTotal',
    ) => {
      for (const record of records) {
        const dayKey = this.formatDateKey(record.occurredAt);
        const existing = grouped.get(dayKey) ?? {
          depositsTotal: new Prisma.Decimal(0),
          withdrawalsTotal: new Prisma.Decimal(0),
          gameEntryTotal: new Prisma.Decimal(0),
          prizePaidTotal: new Prisma.Decimal(0),
        };

        existing[key] = existing[key].plus(record.amount);
        grouped.set(dayKey, existing);
      }
    };

    applyAmount(deposits, 'depositsTotal');
    applyAmount(withdrawals, 'withdrawalsTotal');
    applyAmount(gameEntries, 'gameEntryTotal');
    applyAmount(prizes, 'prizePaidTotal');

    const requestedDays = this.buildRequestedDayKeys(dateRangeQuery);
    if (requestedDays.length > 0) {
      for (const dayKey of requestedDays) {
        if (!grouped.has(dayKey)) {
          grouped.set(dayKey, {
            depositsTotal: new Prisma.Decimal(0),
            withdrawalsTotal: new Prisma.Decimal(0),
            gameEntryTotal: new Prisma.Decimal(0),
            prizePaidTotal: new Prisma.Decimal(0),
          });
        }
      }
    }

    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, totals]) => ({
        date,
        depositsTotal: totals.depositsTotal.toString(),
        withdrawalsTotal: totals.withdrawalsTotal.toString(),
        gameEntryTotal: totals.gameEntryTotal.toString(),
        prizePaidTotal: totals.prizePaidTotal.toString(),
        netRevenue: totals.gameEntryTotal.minus(totals.prizePaidTotal).toString(),
      }));
  }

  private buildDateRange(query: DateRangeQueryDto): Prisma.DateTimeFilter {
    const from = query.from ? this.parseDateBoundary(query.from, 'start') : undefined;
    const to = query.to ? this.parseDateBoundary(query.to, 'end') : undefined;

    if (from && to && from > to) {
      throw new BadRequestException('from must be earlier than or equal to to');
    }

    return {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  private createTodayRange(): Prisma.DateTimeFilter {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setMilliseconds(end.getMilliseconds() - 1);

    return {
      gte: start,
      lte: end,
    };
  }

  private parseDateBoundary(
    rawValue: string,
    boundary: 'start' | 'end',
  ): Date {
    const parsedDate = new Date(rawValue);

    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException(`Invalid ${boundary} date`);
    }

    if (!rawValue.includes('T')) {
      parsedDate.setHours(
        boundary === 'start' ? 0 : 23,
        boundary === 'start' ? 0 : 59,
        boundary === 'start' ? 0 : 59,
        boundary === 'start' ? 0 : 999,
      );
    }

    return parsedDate;
  }

  private buildRequestedDayKeys(query: DateRangeQueryDto): string[] {
    if (!query.from || !query.to) {
      return [];
    }

    const start = this.parseDateBoundary(query.from, 'start');
    const end = this.parseDateBoundary(query.to, 'end');

    if (start > end) {
      throw new BadRequestException('from must be earlier than or equal to to');
    }

    const keys: string[] = [];
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);

    const lastDay = new Date(end);
    lastDay.setHours(0, 0, 0, 0);

    while (cursor <= lastDay) {
      keys.push(this.formatDateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    return keys;
  }

  private formatDateKey(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private sumAmountRecords(records: AmountRecord[]) {
    return records.reduce(
      (total, record) => total.plus(record.amount),
      new Prisma.Decimal(0),
    );
  }
}
