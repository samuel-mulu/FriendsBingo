import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CartelaPaymentSource,
  CompanyFeeSource,
  DepositStatus,
  GameStatus,
  Prisma,
  UserRole,
  UserStatus,
  WalletTransactionType,
  WithdrawStatus,
} from '@prisma/client';
import { AdminExpensesService } from './admin-expenses.service';
import { DateRangeQueryDto } from './dto/date-range-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { centsToDecimal } from '../games/registration-payment.util';

type AmountRecord = {
  amount: Prisma.Decimal;
  occurredAt: Date;
};

type RegistrationAccountingRecord = {
  amount: Prisma.Decimal;
  occurredAt: Date;
  paymentSource: CartelaPaymentSource | null;
  companyFeeSource: CompanyFeeSource | null;
  entryFeeCents: number;
  companyFeeCents: number;
};

@Injectable()
export class AdminReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminExpensesService: AdminExpensesService,
  ) {}

  async getOverview() {
    const todayRange = this.createTodayRange();

    const [
      totalPlayers,
      activePlayers,
      blockedPlayers,
      totalSlots,
      activeSessions,
      finishedSessionsToday,
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
      this.prisma.gameSlot.count(),
      this.prisma.gameSession.count({
        where: {
          status: {
            in: [GameStatus.CHECKING, GameStatus.PLAYING],
          },
        },
      }),
      this.prisma.gameSession.count({
        where: {
          status: {
            in: [GameStatus.FINISHED, GameStatus.NO_WINNER],
          },
          finishedAt: todayRange,
        },
      }),
      this.prisma.deposit.count({
        where: {
          status: {
            in: [
              DepositStatus.PENDING,
              DepositStatus.PENDING,
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
      this.findWalletTransactionsByType(
        WalletTransactionType.GAME_ENTRY,
        todayRange,
      ),
      this.findWalletTransactionsByType(
        WalletTransactionType.PRIZE_WIN,
        todayRange,
      ),
    ]);

    const depositsTodayTotal = this.sumAmountRecords(depositsToday);
    const withdrawalsTodayTotal = this.sumAmountRecords(withdrawalsToday);
    const gameEntryTodayTotal = this.sumAmountRecords(gameEntryToday);
    const prizePaidTodayTotal = this.sumAmountRecords(prizePaidToday);
    const bonusCartelasUsedToday = await this.countBonusCartelasUsed(todayRange);

    return {
      totalPlayers,
      activePlayers,
      blockedPlayers,
      totalSlots,
      activeSessions,
      finishedSessionsToday,
      pendingDeposits,
      pendingWithdrawals,
      depositsTodayTotal: depositsTodayTotal.toString(),
      withdrawalsTodayTotal: withdrawalsTodayTotal.toString(),
      gameEntryTodayTotal: gameEntryTodayTotal.toString(),
      prizePaidTodayTotal: prizePaidTodayTotal.toString(),
      netToday: gameEntryTodayTotal.minus(prizePaidTodayTotal).toString(),
      bonusCartelasUsedToday,
    };
  }

  async getFinancialReport(dateRangeQuery: DateRangeQueryDto) {
    const dateRange = this.buildDateRange(dateRangeQuery);

    const [
      deposits,
      withdrawals,
      gameEntries,
      prizes,
      registrations,
      expenses,
    ] = await Promise.all([
      this.findApprovedDeposits(dateRange),
      this.findPaidWithdrawals(dateRange),
      this.findWalletTransactionsByType(
        WalletTransactionType.GAME_ENTRY,
        dateRange,
      ),
      this.findWalletTransactionsByType(
        WalletTransactionType.PRIZE_WIN,
        dateRange,
      ),
      this.findRegistrationFeeRecords(dateRange),
      this.adminExpensesService.findExpensesInRange(dateRangeQuery),
    ]);

    const depositsTotal = this.sumAmountRecords(deposits);
    const withdrawalsTotal = this.sumAmountRecords(withdrawals);
    const gameEntryTotal = this.sumAmountRecords(gameEntries);
    const prizePaidTotal = this.sumAmountRecords(prizes);
    const registrationTotals = this.sumRegistrationAccounting(registrations);
    const companyFeeTotal = registrationTotals.realCompanyFeeTotal;
    const bonusEntryValueTotal = registrationTotals.bonusEntryValueTotal;
    const bonusCompanyFeeTotal = registrationTotals.bonusCompanyFeeTotal;
    const bonusCartelasUsed = registrationTotals.bonusCartelasUsed;
    const expensesTotal = this.adminExpensesService.sumExpenses(
      expenses.map((expense) => ({
        amount: new Prisma.Decimal(expense.amount),
        expenseDate: new Date(expense.expenseDate),
      })),
    );
    const profitNet = companyFeeTotal.minus(expensesTotal);
    const groupedByDay = this.groupFinancialTotalsByDay(
      deposits,
      withdrawals,
      gameEntries,
      prizes,
      registrations,
      expenses.map((expense) => ({
        amount: new Prisma.Decimal(expense.amount),
        occurredAt: new Date(expense.expenseDate),
      })),
      dateRangeQuery,
    );

    return {
      depositsTotal: depositsTotal.toString(),
      withdrawalsTotal: withdrawalsTotal.toString(),
      gameEntryTotal: gameEntryTotal.toString(),
      prizePaidTotal: prizePaidTotal.toString(),
      netRevenue: gameEntryTotal.minus(prizePaidTotal).toString(),
      registeredCartelasCount: registrations.length,
      companyFeeTotal: companyFeeTotal.toString(),
      bonusEntryValueTotal: bonusEntryValueTotal.toString(),
      bonusCompanyFeeTotal: bonusCompanyFeeTotal.toString(),
      bonusCartelasUsed,
      expensesTotal: expensesTotal.toString(),
      profitNet: profitNet.toString(),
      transactionCount:
        deposits.length +
        withdrawals.length +
        gameEntries.length +
        prizes.length,
      expenses,
      dailyTotals: groupedByDay,
    };
  }

  async getGamesReport(dateRangeQuery: DateRangeQueryDto) {
    const createdAtRange = this.buildDateRange(dateRangeQuery);
    const finishedAtRange = this.buildDateRange(dateRangeQuery);

    const [createdSessions, finishedSessions, registrations] =
      await Promise.all([
        this.prisma.gameSession.findMany({
          where: {
            createdAt: createdAtRange,
          },
          select: {
            id: true,
            prizeAmount: true,
          },
        }),
        this.prisma.gameSession.findMany({
          where: {
            status: {
              in: [GameStatus.FINISHED, GameStatus.NO_WINNER],
            },
            finishedAt: finishedAtRange,
          },
          select: {
            id: true,
            playCode: true,
            prizeAmount: true,
            finishedAt: true,
            winnerCartelaId: true,
            gameSlot: {
              select: {
                name: true,
                gameType: true,
              },
            },
          },
        }),
        this.prisma.gameCartela.findMany({
          where: {
            createdAt: createdAtRange,
          },
          select: {
            id: true,
            gameSessionId: true,
            createdAt: true,
            paymentSource: true,
            entryFeeCents: true,
            companyFeeCents: true,
            companyFeeSource: true,
            gameSession: {
              select: {
                playCode: true,
                entryFee: true,
              },
            },
          },
        }),
      ]);

    const totalPrizeAmount = createdSessions.reduce(
      (total, session) => total.plus(session.prizeAmount),
      new Prisma.Decimal(0),
    );

    const registrationTotals = this.sumRegistrationAccounting(
      registrations.map((registration) => ({
        amount: centsToDecimal(registration.companyFeeCents),
        occurredAt: registration.createdAt,
        paymentSource: registration.paymentSource,
        companyFeeSource: registration.companyFeeSource,
        entryFeeCents: registration.entryFeeCents,
        companyFeeCents: registration.companyFeeCents,
      })),
    );
    const totalEntryFees = registrationTotals.realEntryFeeTotal;
    const bonusEntryValueTotal = registrationTotals.bonusEntryValueTotal;

    const winnerCartelaIds = finishedSessions
      .map((session) => session.winnerCartelaId)
      .filter((winnerCartelaId): winnerCartelaId is string =>
        Boolean(winnerCartelaId),
      );

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
      gamesCreated: createdSessions.length,
      gamesFinished: finishedSessions.length,
      totalRegistrations: registrations.length,
      totalEntryFees: totalEntryFees.toString(),
      bonusEntryValueTotal: bonusEntryValueTotal.toString(),
      bonusCartelasUsed: registrationTotals.bonusCartelasUsed,
      totalPrizeAmount: totalPrizeAmount.toString(),
      averagePlayersPerGame:
        createdSessions.length > 0
          ? Number((registrations.length / createdSessions.length).toFixed(2))
          : 0,
      winners: finishedSessions
        .filter((session) => session.winnerCartelaId)
        .map((session) => {
          const winnerCartela = winnerCartelaById.get(session.winnerCartelaId!);

          return {
            gameId: session.id,
            gameCode: session.playCode,
            gameName: session.gameSlot.name,
            gameType: session.gameSlot.gameType,
            finishedAt: session.finishedAt,
            prizeAmount: session.prizeAmount.toString(),
            winnerCartelaId: session.winnerCartelaId,
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
      .filter(
        (deposit): deposit is { amount: Prisma.Decimal; verifiedAt: Date } =>
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

  private async findRegistrationFeeRecords(
    dateRange: Prisma.DateTimeFilter,
  ): Promise<RegistrationAccountingRecord[]> {
    const registrations = await this.prisma.gameCartela.findMany({
      where: {
        createdAt: dateRange,
      },
      select: {
        createdAt: true,
        paymentSource: true,
        entryFeeCents: true,
        companyFeeCents: true,
        companyFeeSource: true,
      },
    });

    return registrations.map((registration) => ({
      amount: centsToDecimal(registration.companyFeeCents),
      occurredAt: registration.createdAt,
      paymentSource: registration.paymentSource,
      companyFeeSource: registration.companyFeeSource,
      entryFeeCents: registration.entryFeeCents,
      companyFeeCents: registration.companyFeeCents,
    }));
  }

  private async countBonusCartelasUsed(dateRange: Prisma.DateTimeFilter) {
    return this.prisma.gameCartela.count({
      where: {
        createdAt: dateRange,
        paymentSource: CartelaPaymentSource.BONUS_CARTELA,
      },
    });
  }

  private sumRegistrationAccounting(records: RegistrationAccountingRecord[]) {
    return records.reduce(
      (totals, record) => {
        if (record.paymentSource === CartelaPaymentSource.BONUS_CARTELA) {
          totals.bonusCartelasUsed += 1;
          totals.bonusEntryValueTotal = totals.bonusEntryValueTotal.plus(
            centsToDecimal(record.entryFeeCents),
          );
        } else if (record.paymentSource === CartelaPaymentSource.MONEY_WALLET) {
          totals.realEntryFeeTotal = totals.realEntryFeeTotal.plus(
            centsToDecimal(record.entryFeeCents),
          );
        }

        if (record.companyFeeSource === CompanyFeeSource.BONUS) {
          totals.bonusCompanyFeeTotal = totals.bonusCompanyFeeTotal.plus(
            centsToDecimal(record.companyFeeCents),
          );
        } else if (record.companyFeeSource === CompanyFeeSource.MONEY) {
          totals.realCompanyFeeTotal = totals.realCompanyFeeTotal.plus(
            centsToDecimal(record.companyFeeCents),
          );
        }

        return totals;
      },
      {
        realEntryFeeTotal: new Prisma.Decimal(0),
        bonusEntryValueTotal: new Prisma.Decimal(0),
        realCompanyFeeTotal: new Prisma.Decimal(0),
        bonusCompanyFeeTotal: new Prisma.Decimal(0),
        bonusCartelasUsed: 0,
      },
    );
  }

  private groupFinancialTotalsByDay(
    deposits: AmountRecord[],
    withdrawals: AmountRecord[],
    gameEntries: AmountRecord[],
    prizes: AmountRecord[],
    companyFees: RegistrationAccountingRecord[],
    expenses: AmountRecord[],
    dateRangeQuery: DateRangeQueryDto,
  ) {
    const grouped = new Map<
      string,
      {
        depositsTotal: Prisma.Decimal;
        withdrawalsTotal: Prisma.Decimal;
        gameEntryTotal: Prisma.Decimal;
        prizePaidTotal: Prisma.Decimal;
        companyFeeTotal: Prisma.Decimal;
        expensesTotal: Prisma.Decimal;
      }
    >();

    const applyAmount = (
      records: AmountRecord[],
      key:
        | 'depositsTotal'
        | 'withdrawalsTotal'
        | 'gameEntryTotal'
        | 'prizePaidTotal'
        | 'companyFeeTotal'
        | 'expensesTotal',
    ) => {
      for (const record of records) {
        const dayKey = this.formatDateKey(record.occurredAt);
        const existing = grouped.get(dayKey) ?? {
          depositsTotal: new Prisma.Decimal(0),
          withdrawalsTotal: new Prisma.Decimal(0),
          gameEntryTotal: new Prisma.Decimal(0),
          prizePaidTotal: new Prisma.Decimal(0),
          companyFeeTotal: new Prisma.Decimal(0),
          expensesTotal: new Prisma.Decimal(0),
        };

        existing[key] = existing[key].plus(record.amount);
        grouped.set(dayKey, existing);
      }
    };

    applyAmount(deposits, 'depositsTotal');
    applyAmount(withdrawals, 'withdrawalsTotal');
    applyAmount(gameEntries, 'gameEntryTotal');
    applyAmount(prizes, 'prizePaidTotal');
    for (const record of companyFees) {
      const dayKey = this.formatDateKey(record.occurredAt);
      const existing = grouped.get(dayKey) ?? {
        depositsTotal: new Prisma.Decimal(0),
        withdrawalsTotal: new Prisma.Decimal(0),
        gameEntryTotal: new Prisma.Decimal(0),
        prizePaidTotal: new Prisma.Decimal(0),
        companyFeeTotal: new Prisma.Decimal(0),
        expensesTotal: new Prisma.Decimal(0),
      };

      if (record.companyFeeSource === CompanyFeeSource.MONEY) {
        existing.companyFeeTotal = existing.companyFeeTotal.plus(record.amount);
      }

      grouped.set(dayKey, existing);
    }
    applyAmount(expenses, 'expensesTotal');

    const requestedDays = this.buildRequestedDayKeys(dateRangeQuery);
    if (requestedDays.length > 0) {
      for (const dayKey of requestedDays) {
        if (!grouped.has(dayKey)) {
          grouped.set(dayKey, {
            depositsTotal: new Prisma.Decimal(0),
            withdrawalsTotal: new Prisma.Decimal(0),
            gameEntryTotal: new Prisma.Decimal(0),
            prizePaidTotal: new Prisma.Decimal(0),
            companyFeeTotal: new Prisma.Decimal(0),
            expensesTotal: new Prisma.Decimal(0),
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
        netRevenue: totals.gameEntryTotal
          .minus(totals.prizePaidTotal)
          .toString(),
        companyFeeTotal: totals.companyFeeTotal.toString(),
        expensesTotal: totals.expensesTotal.toString(),
        profitNet: totals.companyFeeTotal
          .minus(totals.expensesTotal)
          .toString(),
      }));
  }

  private buildDateRange(query: DateRangeQueryDto): Prisma.DateTimeFilter {
    const from = query.from
      ? this.parseDateBoundary(query.from, 'start')
      : undefined;
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

  private parseDateBoundary(rawValue: string, boundary: 'start' | 'end'): Date {
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
