import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GameOperationMode, GameStatus, Prisma } from '@prisma/client';
import { GameEngineService } from './game-engine.service';

describe('GameEngineService', () => {
  function createSessionRecord(overrides?: Record<string, unknown>) {
    return {
      id: 'session-1',
      gameSlotId: 'slot-1',
      playCode: 'BINGO-ABC123',
      entryFee: new Prisma.Decimal('10'),
      prizePerCartela: new Prisma.Decimal('8'),
      companyFeePerCartela: new Prisma.Decimal('2'),
      prizeAmount: new Prisma.Decimal('0'),
      companyRevenue: new Prisma.Decimal('0'),
      status: GameStatus.PLAYING,
      startedAt: new Date('2026-06-06T10:00:00.000Z'),
      finishedAt: null,
      winnerCartelaId: null,
      createdAt: new Date('2026-06-06T10:00:00.000Z'),
      updatedAt: new Date('2026-06-06T10:00:00.000Z'),
      gameSlot: {
        id: 'slot-1',
        staticCode: 'MANUAL-S1',
        name: 'Manual',
        gameType: 'MANUAL',
        gameRuleId: 'rule-1',
        status: GameStatus.PLAYING,
        entryFee: new Prisma.Decimal('10'),
        prizePerCartela: new Prisma.Decimal('8'),
        sortOrder: 1,
        createdAt: new Date('2026-06-06T09:00:00.000Z'),
        updatedAt: new Date('2026-06-06T09:00:00.000Z'),
        gameRule: {
          id: 'rule-1',
          key: 'MANUAL',
          name: 'Manual',
          description: null,
          isActive: true,
          sortOrder: 1,
        },
        operationMode: GameOperationMode.AUTO,
        category: 'NORMAL',
      },
      _count: {
        gameCartelas: 0,
        calledNumbers: 0,
      },
      ...overrides,
    };
  }

  function createService(overrides?: {
    activeSession?: Record<string, unknown> | null;
    readySession?: Record<string, unknown> | null;
    slot?: Record<string, unknown> | null;
    session?: Record<string, unknown>;
    finishUpdateCount?: number;
  }) {
    const tx = {
      gameSession: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(overrides?.activeSession ?? null) // First call - active session check
          .mockResolvedValueOnce(overrides?.readySession ?? null),   // Second call - ready session check
        create: jest
          .fn()
          .mockResolvedValue(createSessionRecord(overrides?.session)),
        findUnique: jest.fn().mockResolvedValue({ gameSlotId: 'slot-1' }),
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: overrides?.finishUpdateCount ?? 1 }),
        update: jest.fn().mockResolvedValue(createSessionRecord(overrides?.session)),
      },
      gameSlot: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            overrides && 'slot' in overrides
              ? overrides.slot
              : {
                  gameType: 'MANUAL',
                  name: 'Manual',
                  entryFee: new Prisma.Decimal('10'),
                  prizePerCartela: new Prisma.Decimal('8'),
                  category: 'NORMAL',
                  fixedPrizeAmount: null,
                },
          ),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
      gameSession: {
        findFirst: jest.fn().mockResolvedValue(null), // Outer check for existing PLAYING/CHECKING sessions
        findUnique: jest
          .fn()
          .mockResolvedValue(
            createSessionRecord({
              status: GameStatus.FINISHED,
              finishedAt: new Date('2026-06-06T11:00:00.000Z'),
            }),
          ),
      },
      gameSlot: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'slot-1',
          staticCode: 'MANUAL-S1',
          name: 'Manual',
          gameType: 'MANUAL',
          status: GameStatus.NEXT,
          entryFee: new Prisma.Decimal('10'),
          prizePerCartela: new Prisma.Decimal('8'),
          sortOrder: 1,
          gameRule: {
            id: 'rule-1',
            name: 'Manual',
            key: 'MANUAL',
          },
          sessions: [
            {
              id: 'session-1',
              playCode: 'BINGO-ABC123',
              status: GameStatus.FINISHED,
              prizeAmount: new Prisma.Decimal('8'),
              startedAt: new Date('2026-06-06T10:00:00.000Z'),
              finishedAt: new Date('2026-06-06T11:00:00.000Z'),
              winnerCartelaId: 'cartela-1',
              _count: {
                gameCartelas: 1,
                calledNumbers: 0,
              },
            },
          ],
        }),
      },
    };

    const realtimeService = {
      emitToSession: jest.fn(),
      emitToAdmin: jest.fn(),
      emitToPublicGames: jest.fn(),
      emitGameFinished: jest.fn(),
      emitGameOperationUpdate: jest.fn(),
    };

    const auditLogService = {
      create: jest.fn().mockResolvedValue(undefined),
    };

    const gameQueueService = {
      assertSlotReady: jest.fn().mockResolvedValue(undefined),
      restoreSlotAfterSession: jest.fn().mockResolvedValue('requeued'),
    };

    const operationsCacheService = {
      invalidate: jest.fn(),
    };

    const postGameRegistrationOpenerService = {
      openNextAutoQueueRegistration: jest.fn().mockResolvedValue(false),
    };

    const notificationsService = {
      createAndSendNotifications: jest.fn().mockResolvedValue(undefined),
    };

    const gamePushNotificationsService = {
      notifyGameStarted: jest.fn().mockResolvedValue(undefined),
    };

    const lifecycleLogger = {
      sessionStatusChanged: jest.fn(),
      slotStatusChanged: jest.fn(),
      sessionCreated: jest.fn(),
      gameStarted: jest.fn(),
    };

    const invariantsService = {
      assertGameOperationInvariants: jest.fn(),
    };

    return {
      service: new GameEngineService(
        prisma as never,
        realtimeService as never,
        auditLogService as never,
        gameQueueService as never,
        operationsCacheService as never,
        { evaluate: jest.fn() } as never,
        postGameRegistrationOpenerService as never,
        { getNoWinnerGraceSeconds: jest.fn().mockResolvedValue(30) } as never,
        notificationsService as never,
        gamePushNotificationsService as never,
        lifecycleLogger as never,
        invariantsService as never,
      ),
      operationsCacheService,
      postGameRegistrationOpenerService,
      tx,
      realtimeService,
      auditLogService,
      gameQueueService,
    };
  }

  it('starts a slot with the default fee split', async () => {
    const { service, tx } = createService();

    const result = await service.startGame('slot-1', 'admin-1');

    expect(tx.gameSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entryFee: expect.any(Prisma.Decimal),
          prizePerCartela: expect.any(Prisma.Decimal),
          companyFeePerCartela: expect.any(Prisma.Decimal),
          prizeAmount: expect.any(Prisma.Decimal),
          companyRevenue: expect.any(Prisma.Decimal),
        }),
      }),
    );

    const createPayload = tx.gameSession.create.mock.calls[0][0].data;
    expect(createPayload.entryFee.toString()).toBe('10');
    expect(createPayload.prizePerCartela.toString()).toBe('8');
    expect(createPayload.companyFeePerCartela.toString()).toBe('2');
    expect(createPayload.prizeAmount.toString()).toBe('0');
    expect(createPayload.companyRevenue.toString()).toBe('0');
    expect(result.entryFee).toBe('10');
    expect(result.prizePerCartela).toBe('8');
    expect(result.companyFeePerCartela).toBe('2');
  });

  it('rejects an invalid fee split override', async () => {
    const { service } = createService();

    await expect(
      service.startGame('slot-1', 'admin-1', {
        entryFee: '10',
        prizePerCartela: '7',
        companyFeePerCartela: '2',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('restores the slot through the queue service after finish', async () => {
    const { service, gameQueueService } = createService();

    const result = await service.finishGameWithWinner(
      {
        gameSession: {
          findUnique: jest.fn().mockResolvedValue({ gameSlotId: 'slot-1' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        gameSlot: {
          update: jest.fn().mockResolvedValue(undefined),
        },
      } as never,
      'session-1',
      'cartela-1',
      new Date('2026-06-06T11:00:00.000Z'),
    );

    expect(result).toBe(true);
    expect(gameQueueService.restoreSlotAfterSession).toHaveBeenCalled();
  });

  it('fails to start if the slot does not exist', async () => {
    const { service } = createService({ slot: null });

    await expect(service.startGame('slot-1', 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('opens the next deferred READY after an AUTO READY session starts', async () => {
    const { service, postGameRegistrationOpenerService } = createService({
      readySession: {
        id: 'session-ready-1',
        entryFee: new Prisma.Decimal('10'),
        prizePerCartela: new Prisma.Decimal('8'),
        companyFeePerCartela: new Prisma.Decimal('2'),
      },
      session: {
        gameSlot: {
          ...createSessionRecord().gameSlot,
          operationMode: GameOperationMode.AUTO,
          category: 'NORMAL',
        },
      },
    });

    await service.startGame('slot-1');

    expect(
      postGameRegistrationOpenerService.openNextAutoQueueRegistration,
    ).toHaveBeenCalledWith({
      allowBehindActiveLive: true,
      countdownMode: 'deferred',
    });
  });
});
