import { GameStatus } from '@prisma/client';
import { GamesService } from './games.service';

describe('GamesService', () => {
  function createGameRecord(overrides?: Record<string, unknown>) {
    return {
      id: 'game-1',
      code: 'FB-111111',
      name: 'Manual',
      gameType: 'MANUAL',
      gameRuleId: 'rule-1',
      entryFee: { toString: () => '10' },
      prizeAmount: { toString: () => '500' },
      status: GameStatus.NEXT,
      playOrder: 1,
      startedAt: null,
      finishedAt: null,
      winnerCartelaId: null,
      createdAt: new Date('2026-06-04T10:00:00.000Z'),
      updatedAt: new Date('2026-06-04T10:00:00.000Z'),
      gameRule: {
        id: 'rule-1',
        key: 'MANUAL',
        name: 'Manual',
        description: null,
        isActive: true,
        sortOrder: 1,
      },
      _count: {
        gameCartelas: 0,
      },
      ...overrides,
    };
  }

  function createService(overrides?: {
    createGameRecords?: Array<Record<string, unknown>>;
    listGames?: Array<Record<string, unknown>>;
  }) {
    const createGameRecords = overrides?.createGameRecords ?? [
      createGameRecord(),
      createGameRecord({
        id: 'game-2',
        code: 'FB-222222',
      }),
    ];

    const tx = {
      game: {
        create: jest
          .fn()
          .mockImplementation(async () => createGameRecords.shift()),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
      game: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue(
          overrides?.listGames ?? [
            createGameRecord({
              id: 'next-2',
              code: 'FB-200000',
              status: GameStatus.NEXT,
              playOrder: 2,
            }),
            createGameRecord({
              id: 'playing-1',
              code: 'FB-100000',
              status: GameStatus.PLAYING,
              playOrder: null,
            }),
            createGameRecord({
              id: 'checking-1',
              code: 'FB-150000',
              status: GameStatus.CHECKING,
              playOrder: null,
            }),
            createGameRecord({
              id: 'next-1',
              code: 'FB-175000',
              status: GameStatus.NEXT,
              playOrder: 1,
            }),
          ],
        ),
      },
    };

    const gameRulesService = {
      getActiveGameRuleOrThrow: jest.fn().mockResolvedValue({
        id: 'rule-1',
        key: 'MANUAL',
        name: 'Manual',
        isActive: true,
        sortOrder: 1,
      }),
    };

    const realtimeService = {
      emitToAdmin: jest.fn(),
      emitToPublicGames: jest.fn(),
    };

    const auditLogService = {
      create: jest.fn().mockResolvedValue(undefined),
    };

    const gameQueueService = {
      assignPlayOrderOnCreate: jest.fn().mockResolvedValue(1),
      compactNextQueue: jest.fn().mockResolvedValue(undefined),
      moveQueueGame: jest.fn().mockResolvedValue(undefined),
    };

    return {
      service: new GamesService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        gameRulesService as never,
        realtimeService as never,
        auditLogService as never,
        gameQueueService as never,
      ),
      prisma,
      gameRulesService,
      realtimeService,
      gameQueueService,
    };
  }

  it('creates a game from the active MANUAL rule and emits game:created', async () => {
    const mathRandomSpy = jest
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0.123456)
      .mockReturnValueOnce(0.654321);
    const { service, gameRulesService, realtimeService } = createService();

    const result = await service.createGame(
      {
        gameRuleId: 'rule-1',
        entryFee: '10',
        prizeAmount: '500',
      },
      'admin-1',
    );

    expect(gameRulesService.getActiveGameRuleOrThrow).toHaveBeenCalledWith(
      'rule-1',
    );
    expect(result.code).toMatch(/^FB-\d{6}$/);
    expect(result.gameRule.key).toBe('MANUAL');
    expect(result.playOrder).toBe(1);
    expect(realtimeService.emitToPublicGames).toHaveBeenCalledWith(
      'game:created',
      expect.objectContaining({
        id: result.id,
      }),
    );

    mathRandomSpy.mockRestore();
  });

  it('allows the same rule to create multiple games with different unique codes', async () => {
    const mathRandomSpy = jest
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0.123456)
      .mockReturnValueOnce(0.654321);
    const { service, gameQueueService } = createService();
    (gameQueueService.assignPlayOrderOnCreate as jest.Mock)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    const first = await service.createGame({
      gameRuleId: 'rule-1',
      entryFee: '10',
      prizeAmount: '500',
    });
    const second = await service.createGame({
      gameRuleId: 'rule-1',
      entryFee: '10',
      prizeAmount: '500',
    });

    expect(first.code).not.toBe(second.code);
    expect(first.gameRule.key).toBe('MANUAL');
    expect(second.gameRule.key).toBe('MANUAL');

    mathRandomSpy.mockRestore();
  });

  it('sorts games by status priority and playOrder for admin lists', async () => {
    const { service } = createService();

    const result = await service.getAdminGames({ page: 1, pageSize: 20 });

    expect(result.items.map((game) => game.id)).toEqual([
      'playing-1',
      'checking-1',
      'next-1',
      'next-2',
    ]);
  });
});
