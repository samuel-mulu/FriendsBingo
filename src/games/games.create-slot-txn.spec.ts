import {
  ConflictException,
  Logger,
} from '@nestjs/common';
import {
  GameCategory,
  GameOperationMode,
  GameStatus,
  Prisma,
} from '@prisma/client';
import { GamesService } from './games.service';

describe('GamesService.createGameSlot transaction boundary', () => {
  const ruleId = 'rule-1';
  const actorId = 'admin-1';
  const slotId = 'slot-1';
  const sessionId = 'session-1';

  const gameRule = {
    id: ruleId,
    key: 'ONE_LINE',
    name: 'One Line',
    description: null,
    isActive: true,
    sortOrder: 1,
  };

  function buildSlot(overrides: Record<string, unknown> = {}) {
    const now = new Date('2026-10-05T12:00:00.000Z');
    return {
      id: slotId,
      staticCode: 'ONE_LINE-S1',
      name: gameRule.name,
      gameType: gameRule.key,
      gameRuleId: ruleId,
      status: GameStatus.NEXT,
      entryFee: new Prisma.Decimal(10),
      prizePerCartela: new Prisma.Decimal(8),
      category: GameCategory.NORMAL,
      fixedPrizeAmount: null,
      maxCartelasPerPlayer: null,
      removeAfterFinish: true,
      roundCount: 1,
      roundPrizes: null,
      roundGameRuleIds: null,
      interRoundDelaySeconds: null,
      currentRound: 1,
      forceBigGameEnabled: false,
      forceBigGameCartelaCount: null,
      sortOrder: 1,
      operationMode: GameOperationMode.MANUAL,
      registrationDurationSeconds: null,
      autoCallIntervalSeconds: null,
      createdAt: now,
      updatedAt: now,
      gameRule,
      sessions: [],
      ...overrides,
    };
  }

  function createHarness(options?: {
    auditReject?: Error;
    txnReject?: Error;
    existingBigGame?: { id: string } | null;
  }) {
    const callOrder: string[] = [];
    let txnOptions: { maxWait?: number; timeout?: number } | undefined;
    let txnCallbackSawPrismaCount = false;
    let auditDbClient: unknown;

    const tx = {
      gameSession: {
        findFirst: jest.fn(async () => options?.existingBigGame ?? null),
        create: jest.fn(async () => ({ id: sessionId })),
      },
      gameSlot: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
          buildSlot({
            staticCode: data.staticCode,
            status: data.status,
            category: data.category,
            operationMode: data.operationMode,
            entryFee: data.entryFee ?? new Prisma.Decimal(10),
            prizePerCartela: data.prizePerCartela ?? new Prisma.Decimal(8),
            fixedPrizeAmount: data.fixedPrizeAmount ?? null,
            roundCount: data.roundCount ?? 1,
            roundPrizes: data.roundPrizes ?? null,
            roundGameRuleIds: data.roundGameRuleIds ?? null,
            interRoundDelaySeconds: data.interRoundDelaySeconds ?? null,
          }),
        ),
        count: jest.fn(async () => {
          txnCallbackSawPrismaCount = true;
          return 0;
        }),
      },
      auditLog: {
        create: jest.fn(async () => {
          throw new Error('tx.auditLog.create must not be called');
        }),
      },
    };

    const prisma = {
      gameSlot: {
        count: jest.fn(async () => {
          callOrder.push('staticCode.count');
          return 0;
        }),
      },
      gameSession: {
        findUnique: jest.fn(async () => null),
      },
      $transaction: jest.fn(
        async (
          callback: (client: typeof tx) => Promise<unknown>,
          opts?: { maxWait?: number; timeout?: number },
        ) => {
          callOrder.push('txn.start');
          txnOptions = opts;
          if (options?.txnReject) {
            throw options.txnReject;
          }
          const result = await callback(tx);
          callOrder.push('txn.commit');
          return result;
        },
      ),
    };

    const auditLogService = {
      create: jest.fn(async (db: unknown) => {
        callOrder.push('audit.create');
        auditDbClient = db;
        if (options?.auditReject) {
          throw options.auditReject;
        }
      }),
    };

    const realtimeService = {
      emitToAdmin: jest.fn(() => callOrder.push('realtime.emitToAdmin')),
      emitToPublicGames: jest.fn(() =>
        callOrder.push('realtime.emitToPublicGames'),
      ),
      emitToSession: jest.fn(),
      emitGameOperationUpdate: jest.fn(() =>
        callOrder.push('realtime.emitGameOperationUpdate'),
      ),
    };

    const operationsCacheService = {
      invalidate: jest.fn(() => callOrder.push('opsCache.invalidate')),
      coalesce: jest.fn(),
      getGeneration: jest.fn(() => 0),
    };

    const gameQueueService = {
      assignSortOrderOnCreate: jest.fn(async (client: unknown) => {
        callOrder.push('queue.assignSortOrder');
        expect(client).toBe(tx);
        return 1;
      }),
    };

    const gameRulesService = {
      getActiveGameRuleOrThrow: jest.fn(async () => gameRule),
      getActiveGameRuleByIdOrThrow: jest.fn(async () => gameRule),
    };

    const gameTimingConfigService = {
      getRegistrationDurationSeconds: jest.fn(async () => 60),
      getAutoCallIntervalSeconds: jest.fn(async () => 7),
      getNormalDefaultEconomics: jest.fn(async () => ({
        entryFee: new Prisma.Decimal(10),
        prizePerCartela: new Prisma.Decimal(8),
      })),
    };

    const postGameRegistrationOpenerService = {
      openNextAutoQueueRegistration: jest.fn(async () => null),
    };

    const lifecycleLogger = {
      sessionCreated: jest.fn(),
    };

    const service = new GamesService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      gameRulesService as never,
      {} as never,
      realtimeService as never,
      auditLogService as never,
      gameQueueService as never,
      {} as never,
      {} as never,
      {} as never,
      {
        run: async (_meta: unknown, fn: () => Promise<unknown>) => fn(),
      } as never,
      operationsCacheService as never,
      {} as never,
      gameTimingConfigService as never,
      {} as never,
      {} as never,
      postGameRegistrationOpenerService as never,
      lifecycleLogger as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    jest
      .spyOn(service as never, 'getCurrentOperations' as never)
      .mockResolvedValue({ queue: [] } as never);
    jest
      .spyOn(service as never, 'getAdminOperationsSnapshot' as never)
      .mockResolvedValue({ queue: [] } as never);

    return {
      service,
      prisma,
      tx,
      auditLogService,
      realtimeService,
      operationsCacheService,
      gameQueueService,
      callOrder,
      getTxnOptions: () => txnOptions,
      getAuditDbClient: () => auditDbClient,
      getTxnCallbackSawPrismaCount: () => txnCallbackSawPrismaCount,
    };
  }

  it('creates a normal slot successfully with post-txn audit and side effects once', async () => {
    const harness = createHarness();

    const result = await harness.service.createGameSlot(
      { gameRuleId: ruleId },
      actorId,
    );

    expect(result.id).toBe(slotId);
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(harness.getTxnOptions()).toEqual({
      maxWait: 10_000,
      timeout: 15_000,
    });
    expect(harness.tx.auditLog.create).not.toHaveBeenCalled();
    expect(harness.tx.gameSlot.count).not.toHaveBeenCalled();
    expect(harness.getTxnCallbackSawPrismaCount()).toBe(false);
    expect(harness.prisma.gameSlot.count).toHaveBeenCalledTimes(1);
    expect(harness.auditLogService.create).toHaveBeenCalledTimes(1);
    expect(harness.getAuditDbClient()).toBe(harness.prisma);
    expect(harness.gameQueueService.assignSortOrderOnCreate).toHaveBeenCalledWith(
      harness.tx,
      ruleId,
    );
    expect(harness.tx.gameSession.findFirst).not.toHaveBeenCalled();
    expect(harness.tx.gameSession.create).not.toHaveBeenCalled();

    expect(harness.callOrder).toEqual([
      'staticCode.count',
      'txn.start',
      'queue.assignSortOrder',
      'txn.commit',
      'audit.create',
      'realtime.emitToAdmin',
      'realtime.emitToPublicGames',
      'opsCache.invalidate',
      'realtime.emitGameOperationUpdate',
    ]);
    expect(harness.realtimeService.emitToAdmin).toHaveBeenCalledTimes(1);
    expect(harness.realtimeService.emitToPublicGames).toHaveBeenCalledTimes(1);
    expect(harness.operationsCacheService.invalidate).toHaveBeenCalledTimes(1);
    expect(
      harness.realtimeService.emitGameOperationUpdate,
    ).toHaveBeenCalledTimes(1);
  });

  it('creates a Big Game slot with uniqueness check and session create', async () => {
    const harness = createHarness();
    const opensAt = '2026-10-06T10:00:00.000Z';
    const playAt = '2026-10-06T12:00:00.000Z';

    const result = await harness.service.createGameSlot(
      {
        gameRuleId: ruleId,
        category: GameCategory.BIG_GAME,
        fixedPrizeAmount: '5000',
        entryFee: '25',
        registrationOpensAt: opensAt,
        playStartAt: playAt,
      },
      actorId,
    );

    expect(result.id).toBe(slotId);
    expect(harness.tx.gameSession.findFirst).toHaveBeenCalledTimes(1);
    expect(harness.tx.gameSession.create).toHaveBeenCalledTimes(1);
    expect(harness.tx.gameSlot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: GameStatus.READY,
          category: GameCategory.BIG_GAME,
          operationMode: GameOperationMode.AUTO,
        }),
      }),
    );
    expect(harness.auditLogService.create).toHaveBeenCalledTimes(1);
    expect(harness.getTxnOptions()).toEqual({
      maxWait: 10_000,
      timeout: 15_000,
    });
  });

  it('keeps created slot when post-commit audit fails', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const harness = createHarness({
      auditReject: Object.assign(new Error('audit down'), { code: 'P1001' }),
    });

    const result = await harness.service.createGameSlot(
      { gameRuleId: ruleId },
      actorId,
    );

    expect(result.id).toBe(slotId);
    expect(harness.auditLogService.create).toHaveBeenCalledTimes(1);
    expect(harness.operationsCacheService.invalidate).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[admin_slot_audit_failed]'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`slotId=${slotId}`),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('errorCode=P1001'),
    );

    warnSpy.mockRestore();
  });

  it('does not audit when the business transaction fails', async () => {
    const harness = createHarness({
      txnReject: new ConflictException({
        message: 'A Big Game is already scheduled',
        code: 'BIG_GAME_ALREADY_SCHEDULED',
      }),
    });

    await expect(
      harness.service.createGameSlot({ gameRuleId: ruleId }, actorId),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.auditLogService.create).not.toHaveBeenCalled();
    expect(harness.operationsCacheService.invalidate).not.toHaveBeenCalled();
    expect(harness.realtimeService.emitToAdmin).not.toHaveBeenCalled();
  });

  it('still rejects Big Game create when uniqueness check finds an active big game', async () => {
    const harness = createHarness({
      existingBigGame: { id: 'existing-big' },
    });

    await expect(
      harness.service.createGameSlot(
        {
          gameRuleId: ruleId,
          category: GameCategory.BIG_GAME,
          fixedPrizeAmount: '5000',
          entryFee: '25',
          registrationOpensAt: '2026-10-06T10:00:00.000Z',
          playStartAt: '2026-10-06T12:00:00.000Z',
        },
        actorId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.tx.gameSlot.create).not.toHaveBeenCalled();
    expect(harness.auditLogService.create).not.toHaveBeenCalled();
  });
});
