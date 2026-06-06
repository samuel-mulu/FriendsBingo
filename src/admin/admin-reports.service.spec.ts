import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdminReportsService } from './admin-reports.service';

describe('AdminReportsService', () => {
  it('calculates overview metrics and net today', async () => {
    const prisma = {
      user: {
        count: jest
          .fn()
          .mockResolvedValueOnce(12)
          .mockResolvedValueOnce(10)
          .mockResolvedValueOnce(2),
      },
      gameSlot: {
        count: jest.fn().mockResolvedValue(8),
      },
      gameSession: {
        count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(1),
      },
      deposit: {
        count: jest.fn().mockResolvedValue(4),
        findMany: jest.fn().mockResolvedValue([
          {
            amount: new Prisma.Decimal('200'),
            verifiedAt: new Date('2026-06-03T08:00:00.000Z'),
          },
        ]),
      },
      withdrawal: {
        count: jest.fn().mockResolvedValue(5),
        findMany: jest.fn().mockResolvedValue([
          {
            amount: new Prisma.Decimal('50'),
            paidAt: new Date('2026-06-03T09:00:00.000Z'),
          },
        ]),
      },
      walletTransaction: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              amount: new Prisma.Decimal('75'),
              createdAt: new Date('2026-06-03T10:00:00.000Z'),
            },
          ])
          .mockResolvedValueOnce([
            {
              amount: new Prisma.Decimal('25'),
              createdAt: new Date('2026-06-03T11:00:00.000Z'),
            },
          ]),
      },
    };

    const service = new AdminReportsService(prisma as never);

    const result = await service.getOverview();

    expect(result.totalPlayers).toBe(12);
    expect(result.totalSlots).toBe(8);
    expect(result.activeSessions).toBe(3);
    expect(result.finishedSessionsToday).toBe(1);
    expect(result.depositsTodayTotal).toBe('200');
    expect(result.withdrawalsTodayTotal).toBe('50');
    expect(result.gameEntryTodayTotal).toBe('75');
    expect(result.prizePaidTodayTotal).toBe('25');
    expect(result.netToday).toBe('50');
  });

  it('builds grouped daily financial totals', async () => {
    const prisma = {
      deposit: {
        findMany: jest.fn().mockResolvedValue([
          {
            amount: new Prisma.Decimal('100'),
            verifiedAt: new Date('2026-06-01T08:00:00.000Z'),
          },
          {
            amount: new Prisma.Decimal('50'),
            verifiedAt: new Date('2026-06-02T08:00:00.000Z'),
          },
        ]),
      },
      withdrawal: {
        findMany: jest.fn().mockResolvedValue([
          {
            amount: new Prisma.Decimal('25'),
            paidAt: new Date('2026-06-02T10:00:00.000Z'),
          },
        ]),
      },
      walletTransaction: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              amount: new Prisma.Decimal('40'),
              createdAt: new Date('2026-06-01T12:00:00.000Z'),
            },
          ])
          .mockResolvedValueOnce([
            {
              amount: new Prisma.Decimal('10'),
              createdAt: new Date('2026-06-02T13:00:00.000Z'),
            },
          ]),
      },
    };

    const service = new AdminReportsService(prisma as never);

    const result = await service.getFinancialReport({
      from: '2026-06-01',
      to: '2026-06-02',
    });

    expect(result.depositsTotal).toBe('150');
    expect(result.withdrawalsTotal).toBe('25');
    expect(result.netRevenue).toBe('30');
    expect(result.transactionCount).toBe(5);
    expect(result.dailyTotals).toEqual([
      {
        date: '2026-06-01',
        depositsTotal: '100',
        withdrawalsTotal: '0',
        gameEntryTotal: '40',
        prizePaidTotal: '0',
        netRevenue: '40',
      },
      {
        date: '2026-06-02',
        depositsTotal: '50',
        withdrawalsTotal: '25',
        gameEntryTotal: '0',
        prizePaidTotal: '10',
        netRevenue: '-10',
      },
    ]);
  });

  it('rejects invalid date ranges', async () => {
    const service = new AdminReportsService({} as never);

    await expect(
      service.getFinancialReport({
        from: '2026-06-03',
        to: '2026-06-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
