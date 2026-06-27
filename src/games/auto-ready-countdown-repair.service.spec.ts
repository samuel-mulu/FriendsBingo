import { GameOperationMode, GameStatus } from '@prisma/client';
import {
  AUTO_COUNTDOWN_REPAIRED_REASON,
  AutoReadyCountdownRepairService,
} from './auto-ready-countdown-repair.service';

describe('AutoReadyCountdownRepairService', () => {
  function createSessionRecord(scheduledStartAt: Date) {
    return {
      id: 'session-1',
      gameSlotId: 'slot-1',
      playCode: 'BINGO-AUTO1',
      entryFee: { toString: () => '10' },
      prizePerCartela: { toString: () => '8' },
      companyFeePerCartela: { toString: () => '2' },
      prizeAmount: { toString: () => '240' },
      companyRevenue: { toString: () => '60' },
      status: GameStatus.READY,
      autoCallEnabled: false,
      autoCallIntervalMs: 7000,
      nextAutoCallAt: null,
      startedAt: null,
      finishedAt: null,
      cancelledReason: null,
      winnerCartelaId: null,
      winnerWindowStartedAt: null,
      winnerWindowEndsAt: null,
      prizeFinalizedAt: null,
      scheduledStartAt,
      createdAt: new Date('2026-06-10T11:59:00.000Z'),
      updatedAt: new Date('2026-06-10T12:00:00.000Z'),
      gameSlot: {
        id: 'slot-1',
        staticCode: 'MIX_09-S2',
        name: 'Mixed',
        gameType: 'MIX_09',
        gameRuleId: 'rule-1',
        status: GameStatus.NEXT,
        entryFee: { toString: () => '10' },
        prizePerCartela: { toString: () => '8' },
        sortOrder: 2,
        operationMode: GameOperationMode.AUTO,
        registrationDurationSeconds: 60,
        autoCallIntervalSeconds: 7,
        createdAt: new Date('2026-06-10T11:00:00.000Z'),
        updatedAt: new Date('2026-06-10T12:00:00.000Z'),
        gameRule: { id: 'rule-1', key: 'MIX_09', name: 'Mixed' },
      },
      _count: { gameCartelas: 30, calledNumbers: 0 },
      gameCartelas: [],
      gameCartelaReservations: [],
    };
  }

  function createService(options?: { claimCount?: number }) {
    const repairedAt = new Date('2026-06-10T12:01:00.000Z');
    const prisma = {
      gameSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({
          count: options?.claimCount ?? 1,
        }),
        findUnique: jest
          .fn()
          .mockResolvedValue(createSessionRecord(repairedAt)),
        findMany: jest.fn().mockResolvedValue([{ id: 'session-1' }]),
      },
    };
    const gameTimingConfigService = {
      getRegistrationDurationSeconds: jest.fn().mockResolvedValue(60),
      getFinishedResultDisplaySeconds: jest.fn().mockResolvedValue(60),
    };
    const operationsCacheService = { invalidate: jest.fn() };
    const realtimeService = { emitGameOperationUpdate: jest.fn() };
    const service = new AutoReadyCountdownRepairService(
      prisma as never,
      gameTimingConfigService as never,
      operationsCacheService as never,
      realtimeService as never,
    );

    return {
      service,
      prisma,
      gameTimingConfigService,
      operationsCacheService,
      realtimeService,
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-10T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('repairs AUTO READY sessions missing scheduledStartAt', async () => {
    const {
      service,
      prisma,
      gameTimingConfigService,
      operationsCacheService,
      realtimeService,
    } = createService();

    const result =
      await service.ensureAutoReadySessionHasCountdown('session-1');

    expect(
      gameTimingConfigService.getRegistrationDurationSeconds,
    ).toHaveBeenCalled();
    expect(prisma.gameSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'session-1',
        status: GameStatus.READY,
        scheduledStartAt: null,
        gameSlot: {
          operationMode: GameOperationMode.AUTO,
          status: { not: GameStatus.CANCELLED },
        },
      },
      data: { scheduledStartAt: new Date('2026-06-10T12:01:00.000Z') },
    });
    expect(operationsCacheService.invalidate).toHaveBeenCalledTimes(1);
    expect(realtimeService.emitGameOperationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        slotId: 'slot-1',
        sessionId: 'session-1',
        adminPayload: expect.objectContaining({
          sessionId: 'session-1',
          scheduledStartAt: new Date('2026-06-10T12:01:00.000Z'),
          updatedReason: AUTO_COUNTDOWN_REPAIRED_REASON,
          registeredCartelasCount: 30,
        }),
      }),
    );
    expect(result).toEqual({
      repaired: true,
      sessionId: 'session-1',
      slotId: 'slot-1',
      scheduledStartAt: new Date('2026-06-10T12:01:00.000Z'),
    });
  });

  it('does not emit or invalidate when guarded update does not match', async () => {
    const { service, prisma, operationsCacheService, realtimeService } =
      createService({ claimCount: 0 });

    await expect(
      service.ensureAutoReadySessionHasCountdown('session-1'),
    ).resolves.toEqual({ repaired: false });

    expect(prisma.gameSession.findUnique).not.toHaveBeenCalled();
    expect(operationsCacheService.invalidate).not.toHaveBeenCalled();
    expect(realtimeService.emitGameOperationUpdate).not.toHaveBeenCalled();
  });

  it('repairs all currently invalid AUTO READY sessions', async () => {
    const { service, prisma } = createService();

    await expect(service.repairAllMissingAutoReadyCountdowns()).resolves.toBe(
      1,
    );

    expect(prisma.gameSession.findMany).toHaveBeenCalledWith({
      where: {
        status: GameStatus.READY,
        scheduledStartAt: null,
        gameSlot: {
          operationMode: GameOperationMode.AUTO,
          status: { not: GameStatus.CANCELLED },
        },
      },
      select: { id: true },
    });
  });

  it('does not push early READY countdowns during review grace', async () => {
    const prisma = {
      gameSession: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    const service = new AutoReadyCountdownRepairService(
      prisma as never,
      { getRegistrationDurationSeconds: jest.fn() } as never,
      { invalidate: jest.fn() } as never,
      { emitGameOperationUpdate: jest.fn() } as never,
    );

    await expect(
      service.repairEarlyReadyCountdownsDuringReviewGrace(),
    ).resolves.toBe(0);

    expect(prisma.gameSession.findFirst).not.toHaveBeenCalled();
    expect(prisma.gameSession.findMany).not.toHaveBeenCalled();
    expect(prisma.gameSession.updateMany).not.toHaveBeenCalled();
  });
});
