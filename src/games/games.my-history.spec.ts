import { GameStatus } from '@prisma/client';
import { GamesService } from './games.service';

describe('GamesService.getMyAttendedSessionsHistory', () => {
  const sessionRecord = {
    id: 'session-1',
    gameSlotId: 'slot-1',
    playCode: '123456',
    entryFee: { toString: () => '5.00' },
    prizePerCartela: { toString: () => '10.00' },
    companyFeePerCartela: { toString: () => '1.00' },
    prizeAmount: { toString: () => '100.00' },
    companyRevenue: { toString: () => '20.00' },
    status: GameStatus.FINISHED,
    autoCallEnabled: false,
    autoCallIntervalMs: 7000,
    nextAutoCallAt: null,
    scheduledStartAt: null,
    startedAt: new Date('2026-06-15T12:00:00.000Z'),
    finishedAt: new Date('2026-06-15T12:30:00.000Z'),
    cancelledReason: null,
    winnerWindowStartedAt: null,
    winnerWindowEndsAt: null,
    prizeFinalizedAt: null,
    winnerCartelaId: null,
    createdAt: new Date('2026-06-15T12:00:00.000Z'),
    updatedAt: new Date('2026-06-15T12:30:00.000Z'),
    gameSlot: {
      id: 'slot-1',
      staticCode: 'FULL_HOUSE-S1',
      name: 'Full House',
      gameType: 'FULL_HOUSE',
      gameRuleId: 'rule-1',
      sortOrder: 1,
      status: GameStatus.FINISHED,
      entryFee: { toString: () => '5.00' },
      prizePerCartela: { toString: () => '10.00' },
      companyFeePerCartela: { toString: () => '1.00' },
      createdAt: new Date('2026-06-15T12:00:00.000Z'),
      updatedAt: new Date('2026-06-15T12:30:00.000Z'),
      gameRule: {
        id: 'rule-1',
        key: 'FULL_HOUSE',
        name: 'Full House',
      },
    },
    _count: {
      gameCartelas: 2,
      calledNumbers: 10,
    },
  };

  const cartelaRecord = {
    id: 'gc-1',
    gameSessionId: 'session-1',
    userId: 'user-1',
    cartelaId: 'cartela-1',
    status: 'REGISTERED',
    isWinner: false,
    markedCells: null,
    blockedAt: null,
    createdAt: new Date('2026-06-15T12:00:00.000Z'),
    updatedAt: new Date('2026-06-15T12:00:00.000Z'),
    cartela: {
      id: 'cartela-1',
      number: 12,
      b: [1, 2, 3, 4, 5],
      i: [6, 7, 8, 9, 10],
      n: [11, 12, 'FREE', 14, 15],
      g: [16, 17, 18, 19, 20],
      o: [21, 22, 23, 24, 25],
      createdAt: new Date('2026-06-15T12:00:00.000Z'),
    },
  };

  function createService() {
    const prisma = {
      gameSession: {
        findMany: jest.fn().mockResolvedValue([sessionRecord]),
        count: jest.fn().mockResolvedValue(1),
      },
      gameCartela: {
        findMany: jest.fn().mockResolvedValue([cartelaRecord]),
      },
    };

    const requestPerformance = {
      run: jest.fn(
        async (
          _context: unknown,
          callback: () => Promise<unknown>,
          _metrics?: (result: unknown) => unknown,
        ) => callback(),
      ),
    };

    const service = new GamesService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      requestPerformance as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { service, prisma };
  }

  it('returns only attended finished sessions with embedded my cartelas', async () => {
    const { service, prisma } = createService();

    const result = await service.getMyAttendedSessionsHistory('user-1', {
      page: 1,
      pageSize: 50,
    });

    expect(prisma.gameSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: {
            in: [GameStatus.FINISHED, GameStatus.NO_WINNER],
          },
          gameCartelas: { some: { userId: 'user-1' } },
        },
      }),
    );
    expect(prisma.gameCartela.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          gameSessionId: { in: ['session-1'] },
        },
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].myCartelas).toHaveLength(1);
    expect(result.items[0].myCartelas[0].cartela.number).toBe(12);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.pageSize).toBe(50);
  });
});
