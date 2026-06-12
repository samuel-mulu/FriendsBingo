import { ConflictException } from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import { RequestPerformanceContext } from '../common/performance/request-performance.context';
import { CalledNumbersService } from './called-numbers.service';

function createUniqueConstraintError() {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
  });
}

function createService({
  createImpl,
}: {
  createImpl?: () => unknown;
} = {}) {
  let createAttempts = 0;

  const tx = {
    gameSession: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'session-1',
        status: GameStatus.PLAYING,
        gameSlotId: 'slot-1',
      }),
    },
    calledNumber: {
      findFirst: jest.fn().mockImplementation(({ orderBy }) => {
        if (orderBy) {
          return Promise.resolve({ order: 34 });
        }

        return Promise.resolve(null);
      }),
      create: jest.fn().mockImplementation(() => {
        createAttempts += 1;

        if (createImpl) {
          return createImpl();
        }

        if (createAttempts === 1) {
          throw createUniqueConstraintError();
        }

        return {
          id: 'called-2',
          gameSessionId: 'session-1',
          letter: 'B',
          number: 15,
          order: 35,
          createdAt: new Date('2026-06-10T12:00:00.000Z'),
        };
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  const realtimeService = {
    emitToSession: jest.fn(),
    emitToAdmin: jest.fn(),
    emitToPublicGames: jest.fn(),
  };

  const auditLogService = {
    create: jest.fn().mockResolvedValue(undefined),
  };

  const service = new CalledNumbersService(
    prisma as never,
    realtimeService as never,
    auditLogService as never,
    new RequestPerformanceContext(),
  );

  return {
    service,
    prisma,
    realtimeService,
    auditLogService,
    tx,
    getCreateAttempts: () => createAttempts,
  };
}

describe('CalledNumbersService', () => {
  it('rejects duplicate called numbers in the same session', async () => {
    const tx = {
      gameSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          status: GameStatus.PLAYING,
        }),
      },
      calledNumber: {
        findFirst: jest.fn().mockResolvedValue({ id: 'called-1' }),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const service = new CalledNumbersService(
      prisma as never,
      {
        emitToSession: jest.fn(),
        emitToAdmin: jest.fn(),
      } as never,
      {
        create: jest.fn().mockResolvedValue(undefined),
      } as never,
      new RequestPerformanceContext(),
    );

    await expect(
      service.callNumber('session-1', { letter: 'B', number: 15 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('retries once after an order unique conflict and succeeds', async () => {
    const { service, prisma, getCreateAttempts } = createService();

    const result = await service.callNumber('session-1', {
      letter: 'B',
      number: 15,
    });

    expect(getCreateAttempts()).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      id: 'called-2',
      gameSessionId: 'session-1',
      letter: 'B',
      number: 15,
      order: 35,
    });
  });

  it('throws after two unique constraint failures', async () => {
    const { service } = createService({
      createImpl: () => {
        throw createUniqueConstraintError();
      },
    });

    await expect(
      service.callNumber('session-1', { letter: 'B', number: 15 }),
    ).rejects.toThrow(
      'Called number already exists or ordering conflict occurred',
    );
  });

  it('emits game:number_called to session, admin, and public without operation_updated', async () => {
    const { service, realtimeService } = createService();

    const result = await service.callNumber('session-1', {
      letter: 'B',
      number: 15,
    });

    expect(result).toEqual(
      expect.objectContaining({
        gameSessionId: 'session-1',
        slotId: 'slot-1',
        playerStatus: 'playing',
      }),
    );
    expect(realtimeService.emitToSession).toHaveBeenCalledWith(
      'session-1',
      'game:number_called',
      result,
    );
    expect(realtimeService.emitToAdmin).toHaveBeenCalledWith(
      'game:number_called',
      result,
    );
    expect(realtimeService.emitToPublicGames).toHaveBeenCalledWith(
      'game:number_called',
      result,
    );
    expect(realtimeService.emitToPublicGames).not.toHaveBeenCalledWith(
      'game:operation_updated',
      expect.anything(),
    );
  });
});
