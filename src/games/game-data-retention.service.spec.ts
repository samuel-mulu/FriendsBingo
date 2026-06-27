import { GameStatus } from '@prisma/client';
import { GameDataRetentionService } from './game-data-retention.service';

describe('GameDataRetentionService', () => {
  const now = new Date('2026-06-25T12:00:00.000Z');

  function createService(retentionDays = 90) {
    const prisma = {
      gameSession: {
        findMany: jest.fn().mockResolvedValue([{ id: 'session-old' }]),
      },
      calledNumber: {
        deleteMany: jest.fn().mockResolvedValue({ count: 120 }),
      },
      bingoClaim: {
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      gameCartela: {
        deleteMany: jest.fn().mockResolvedValue({ count: 45 }),
      },
    };

    const configService = {
      get: jest.fn((key: string, defaultValue?: number) => {
        if (key === 'GAME_DETAIL_RETENTION_DAYS') {
          return retentionDays;
        }
        return defaultValue;
      }),
    };

    const service = new GameDataRetentionService(
      prisma as never,
      configService as never,
    );

    return { service, prisma, configService };
  }

  it('skips retention when GAME_DETAIL_RETENTION_DAYS is zero', async () => {
    const { service, prisma } = createService(0);

    await service.runRetention(now);

    expect(prisma.gameSession.findMany).not.toHaveBeenCalled();
  });

  it('deletes detail rows for finished sessions past retention', async () => {
    const { service, prisma } = createService(90);

    await service.runRetention(now);

    expect(prisma.gameSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              status: {
                in: [
                  GameStatus.FINISHED,
                  GameStatus.NO_WINNER,
                  GameStatus.CANCELLED,
                ],
              },
            }),
          ]),
        }),
      }),
    );
    expect(prisma.calledNumber.deleteMany).toHaveBeenCalledWith({
      where: { gameSessionId: { in: ['session-old'] } },
    });
    expect(prisma.bingoClaim.deleteMany).toHaveBeenCalledWith({
      where: { gameSessionId: { in: ['session-old'] } },
    });
    expect(prisma.gameCartela.deleteMany).toHaveBeenCalledWith({
      where: { gameSessionId: { in: ['session-old'] } },
    });
    expect(prisma.gameSession.deleteMany).toBeUndefined();
  });
});
