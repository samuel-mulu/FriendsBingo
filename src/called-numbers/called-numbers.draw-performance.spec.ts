import { BadRequestException } from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import { RequestPerformanceContext } from '../common/performance/request-performance.context';
import { CalledNumbersService } from './called-numbers.service';

function createDrawPerformanceService(options?: {
  usedNumbers?: number[];
  latestOrder?: number;
}) {
  const usedNumbers = options?.usedNumbers ?? [];
  const latestOrder = options?.latestOrder ?? usedNumbers.length;
  const remainingNumbers = Array.from(
    { length: 75 },
    (_, index) => index + 1,
  ).filter((number) => !usedNumbers.includes(number));

  const realtimeService = {
    emitToSession: jest.fn(),
    emitToAdmin: jest.fn(),
    emitToPublicGames: jest.fn(),
  };

    const tx = {
      gameSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          status: GameStatus.PLAYING,
          gameSlotId: 'slot-1',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    calledNumber: {
      findFirst: jest.fn().mockImplementation(({ where, orderBy }) => {
        if (orderBy) {
          return Promise.resolve(
            latestOrder > 0 ? { order: latestOrder } : null,
          );
        }

        if (usedNumbers.includes(where.number)) {
          return Promise.resolve({ id: `called-${where.number}` });
        }

        return Promise.resolve(null);
      }),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: `called-${data.number}`,
          gameSessionId: data.gameSessionId,
          letter: data.letter,
          number: data.number,
          order: data.order,
          createdAt: new Date('2026-06-10T12:00:00.000Z'),
        }),
      ),
    },
  };

    const prisma = {
      $queryRaw: jest.fn().mockImplementation(() =>
        Promise.resolve(
          remainingNumbers.length > 0
            ? [
                {
                  number: remainingNumbers[remainingNumbers.length - 1],
                  remainingCount: BigInt(remainingNumbers.length),
                },
              ]
            : [],
        ),
      ),
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
      gameSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          autoCallEnabled: true,
          nextAutoCallAt: new Date('2026-06-10T12:00:17.000Z'),
        autoCallIntervalMs: 15000,
      }),
    },
  };

  const requestPerformance = {
    run: jest.fn(),
  };

  const service = new CalledNumbersService(
    prisma as never,
    realtimeService as never,
    {
      create: jest.fn().mockResolvedValue(undefined),
    } as never,
    requestPerformance as never,
  );

  return { service, prisma, tx, requestPerformance, realtimeService };
}

describe('CalledNumbersService draw performance', () => {
  it('callRandomNumber queries only number column, not full getCalledNumbers', async () => {
    const { service, prisma, requestPerformance } = createDrawPerformanceService(
      {
        usedNumbers: [1, 2, 3],
      },
    );

    await service.callRandomNumber('session-1');

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(requestPerformance.run).not.toHaveBeenCalled();
  });

  it('callRandomNumber selects only uncalled numbers', async () => {
    const usedNumbers = Array.from({ length: 74 }, (_, index) => index + 1);
    const { service, tx } = createDrawPerformanceService({
      usedNumbers,
      latestOrder: 74,
    });

    await service.callRandomNumber('session-1');

    expect(tx.calledNumber.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          number: 75,
          letter: 'O',
          order: 75,
        }),
      }),
    );
  });

  it('callRandomNumber rejects when all 75 numbers are already called', async () => {
    const usedNumbers = Array.from({ length: 75 }, (_, index) => index + 1);
    const { service, prisma } = createDrawPerformanceService({
      usedNumbers,
      latestOrder: 75,
    });

    await expect(service.callRandomNumber('session-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('callRandomNumber emits exactly one socket payload per successful insert', async () => {
    const { service, prisma, realtimeService } = createDrawPerformanceService({
      usedNumbers: [7],
      latestOrder: 1,
    });

    await service.callRandomNumber('session-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(realtimeService.emitToSession).toHaveBeenCalledTimes(1);
    expect(realtimeService.emitToAdmin).toHaveBeenCalledTimes(1);
    expect(realtimeService.emitToPublicGames).toHaveBeenCalledTimes(1);
  });

  it('draw path assigns monotonically increasing order', async () => {
    const { service, tx } = createDrawPerformanceService({
      usedNumbers: [1, 5, 9],
      latestOrder: 3,
    });

    await service.callRandomNumber('session-1');

    expect(tx.calledNumber.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          order: 4,
        }),
      }),
    );
  });

  it('completes random draw quickly with 60 seeded called numbers', async () => {
    const usedNumbers = Array.from({ length: 60 }, (_, index) => index + 1);
    const { service, prisma } = createDrawPerformanceService({
      usedNumbers,
      latestOrder: 60,
    });

    const startedAt = Date.now();
    await service.callRandomNumber('session-1');
    const durationMs = Date.now() - startedAt;

    expect(durationMs).toBeLessThan(100);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
