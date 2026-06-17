import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import {
  AutoCallService,
  DEFAULT_AUTO_CALL_INTERVAL_MS,
} from './auto-call.service';

describe('AutoCallService', () => {
  function createService(options?: {
    dueSessions?: Array<{ id: string; autoCallIntervalMs: number | null }>;
    claimCount?: number;
    sessionLookup?: {
      id: string;
      status: GameStatus;
      autoCallIntervalMs: number | null;
      autoCallEnabled?: boolean;
      gameSlotId?: string;
      nextAutoCallAt?: Date | null;
      calledNumbersCount?: number;
    } | null;
  }) {
    const sessionLookup = options?.sessionLookup;
    const prismaSessionFindUnique = jest.fn().mockResolvedValue(
      sessionLookup
        ? {
            ...sessionLookup,
            _count: {
              calledNumbers: sessionLookup.calledNumbersCount ?? 0,
            },
          }
        : null,
    );

    const prisma = {
      gameSession: {
        findMany: jest
          .fn()
          .mockResolvedValue(options?.dueSessions ?? []),
        findUnique: prismaSessionFindUnique,
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({
          count: options?.claimCount ?? 1,
        }),
      },
    };

    const calledNumbersService = {
      callRandomNumber: jest.fn().mockResolvedValue({
        id: 'called-1',
        gameSessionId: 'session-1',
        letter: 'B',
        number: 7,
        order: 1,
      }),
    };

    const realtimeService = {
      emitToAdmin: jest.fn(),
      emitToPublicGames: jest.fn(),
    };

    const gameTimingConfigService = {
      getAutoCallIntervalMs: jest
        .fn()
        .mockResolvedValue(DEFAULT_AUTO_CALL_INTERVAL_MS),
    };

    const service = new AutoCallService(
      prisma as never,
      gameTimingConfigService as never,
      calledNumbersService as never,
      realtimeService as never,
    );

    return { service, prisma, calledNumbersService, realtimeService };
  }

  it('disables auto-call for terminal session errors', async () => {
    const { service, prisma, calledNumbersService } = createService({
      dueSessions: [{ id: 'session-1', autoCallIntervalMs: 7000 }],
    });
    calledNumbersService.callRandomNumber.mockRejectedValue(
      new BadRequestException('All numbers have been called'),
    );

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(prisma.gameSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'session-1',
          autoCallEnabled: true,
          status: GameStatus.PLAYING,
          nextAutoCallAt: { lte: expect.any(Date) },
        },
        data: {
          nextAutoCallAt: expect.any(Date),
        },
      }),
    );
    expect(prisma.gameSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1', autoCallEnabled: true },
        data: {
          autoCallEnabled: false,
          nextAutoCallAt: null,
        },
      }),
    );
    expect(prisma.gameSession.update).not.toHaveBeenCalled();
  });

  it('keeps auto-call enabled for transient call conflicts and releases the claim', async () => {
    const { service, prisma, calledNumbersService } = createService({
      dueSessions: [{ id: 'session-1', autoCallIntervalMs: 7000 }],
    });
    calledNumbersService.callRandomNumber.mockRejectedValue(
      new ConflictException(
        'Called number already exists or ordering conflict occurred',
      ),
    );

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(prisma.gameSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'session-1',
          autoCallEnabled: true,
        },
        data: {
          nextAutoCallAt: expect.any(Date),
        },
      }),
    );
    expect(prisma.gameSession.update).not.toHaveBeenCalled();
  });

  it('atomically claims nextAutoCallAt before calling a number', async () => {
    const { service, prisma, calledNumbersService } = createService({
      dueSessions: [{ id: 'session-1', autoCallIntervalMs: 7000 }],
    });

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(prisma.gameSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'session-1',
          autoCallEnabled: true,
          status: GameStatus.PLAYING,
          nextAutoCallAt: { lte: expect.any(Date) },
        },
        data: {
          nextAutoCallAt: expect.any(Date),
        },
      }),
    );
    expect(calledNumbersService.callRandomNumber).toHaveBeenCalledWith(
      'session-1',
    );
    expect(prisma.gameSession.update).not.toHaveBeenCalled();
  });

  it('skips calling when the atomic claim loses the race', async () => {
    const { service, prisma, calledNumbersService } = createService({
      dueSessions: [{ id: 'session-1', autoCallIntervalMs: 7000 }],
      claimCount: 0,
    });

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(calledNumbersService.callRandomNumber).not.toHaveBeenCalled();
    expect(prisma.gameSession.update).not.toHaveBeenCalled();
  });

  it('does not call numbers before startAutoCall schedules the first call', async () => {
    const { service, calledNumbersService } = createService({
      dueSessions: [],
    });

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(calledNumbersService.callRandomNumber).not.toHaveBeenCalled();
  });

  it('startAutoCall schedules the first call after the configured interval', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-10T12:00:00.000Z'));

    const { service, prisma, calledNumbersService } = createService({
      sessionLookup: {
        id: 'session-1',
        status: GameStatus.PLAYING,
        autoCallIntervalMs: 7000,
        autoCallEnabled: false,
        gameSlotId: 'slot-1',
        nextAutoCallAt: null,
      },
    });

    await service.startAutoCall('session-1');

    expect(prisma.gameSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: {
        autoCallEnabled: true,
        nextAutoCallAt: new Date('2026-06-10T12:00:07.000Z'),
      },
    });
    expect(calledNumbersService.callRandomNumber).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('startAutoCall uses the default interval when session interval is missing', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-10T12:00:00.000Z'));

    const { service, prisma } = createService({
      sessionLookup: {
        id: 'session-1',
        status: GameStatus.PLAYING,
        autoCallIntervalMs: null,
        gameSlotId: 'slot-1',
      },
    });

    await service.startAutoCall('session-1');

    expect(prisma.gameSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: {
        autoCallEnabled: true,
        nextAutoCallAt: new Date(
          Date.now() + DEFAULT_AUTO_CALL_INTERVAL_MS,
        ),
      },
    });

    jest.useRealTimers();
  });

  it('calls the first ball only after the scheduled interval elapses', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-10T12:00:00.000Z'));

    const { service, prisma, calledNumbersService } = createService({
      sessionLookup: {
        id: 'session-1',
        status: GameStatus.PLAYING,
        autoCallIntervalMs: 7000,
        autoCallEnabled: false,
        gameSlotId: 'slot-1',
        nextAutoCallAt: null,
      },
    });
    const tick = () =>
      (service as unknown as { tick: () => Promise<void> }).tick();

    await service.startAutoCall('session-1');

    prisma.gameSession.findMany.mockResolvedValue([]);
    await tick();
    expect(calledNumbersService.callRandomNumber).not.toHaveBeenCalled();

    prisma.gameSession.findMany.mockResolvedValue([
      { id: 'session-1', autoCallIntervalMs: 7000 },
    ]);
    jest.setSystemTime(new Date('2026-06-10T12:00:07.500Z'));
    await tick();
    expect(calledNumbersService.callRandomNumber).toHaveBeenCalledWith(
      'session-1',
    );

    jest.useRealTimers();
  });

  it('does not call the next ball before nextAutoCallAt elapses', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-10T12:00:00.000Z'));

    const { service, prisma, calledNumbersService } = createService({
      sessionLookup: {
        id: 'session-1',
        status: GameStatus.PLAYING,
        autoCallIntervalMs: 7000,
        autoCallEnabled: true,
        gameSlotId: 'slot-1',
        nextAutoCallAt: new Date('2026-06-10T12:00:00.000Z'),
      },
    });
    const tick = () =>
      (service as unknown as { tick: () => Promise<void> }).tick();

    prisma.gameSession.findMany.mockResolvedValue([
      { id: 'session-1', autoCallIntervalMs: 7000 },
    ]);
    await tick();
    expect(calledNumbersService.callRandomNumber).toHaveBeenCalledTimes(1);

    prisma.gameSession.findMany.mockResolvedValue([]);
    jest.setSystemTime(new Date('2026-06-10T12:00:03.000Z'));
    await tick();
    expect(calledNumbersService.callRandomNumber).toHaveBeenCalledTimes(1);

    prisma.gameSession.findMany.mockResolvedValue([
      { id: 'session-1', autoCallIntervalMs: 7000 },
    ]);
    jest.setSystemTime(new Date('2026-06-10T12:00:07.500Z'));
    await tick();
    expect(calledNumbersService.callRandomNumber).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('does not crash the scheduler when session lookup fails', async () => {
    const { service, prisma } = createService();
    prisma.gameSession.findMany.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(
      (service as unknown as { tick: () => Promise<void> }).tick(),
    ).resolves.toBeUndefined();
  });

  describe('callFirstImmediately option', () => {
    it('calls first ball immediately when callFirstImmediately is true and no balls called', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-10T12:00:00.000Z'));

      const { service, prisma, calledNumbersService } = createService({
        sessionLookup: {
          id: 'session-1',
          status: GameStatus.PLAYING,
          autoCallIntervalMs: 7000,
          autoCallEnabled: false,
          gameSlotId: 'slot-1',
          nextAutoCallAt: null,
          calledNumbersCount: 0,
        },
      });

      const result = await service.startAutoCall('session-1', {
        callFirstImmediately: true,
      });

      // Should set auto-call enabled with nextAutoCallAt for second ball
      expect(prisma.gameSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: {
          autoCallEnabled: true,
          nextAutoCallAt: new Date('2026-06-10T12:00:07.000Z'),
        },
      });

      // Should call first ball immediately
      expect(calledNumbersService.callRandomNumber).toHaveBeenCalledWith(
        'session-1',
      );
      expect(calledNumbersService.callRandomNumber).toHaveBeenCalledTimes(1);

      // Should return firstBallCalled: true
      expect(result).toEqual({
        success: true,
        sessionId: 'session-1',
        autoCallEnabled: true,
        firstBallCalled: true,
      });

      jest.useRealTimers();
    });

    it('does not call first ball immediately when balls already exist', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-10T12:00:00.000Z'));

      const { service, prisma, calledNumbersService } = createService({
        sessionLookup: {
          id: 'session-1',
          status: GameStatus.PLAYING,
          autoCallIntervalMs: 7000,
          autoCallEnabled: false,
          gameSlotId: 'slot-1',
          nextAutoCallAt: null,
          calledNumbersCount: 5, // Balls already called
        },
      });

      const result = await service.startAutoCall('session-1', {
        callFirstImmediately: true,
      });

      // Should use standard path: first ball after interval
      expect(prisma.gameSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: {
          autoCallEnabled: true,
          nextAutoCallAt: new Date('2026-06-10T12:00:07.000Z'),
        },
      });

      // Should NOT call first ball immediately
      expect(calledNumbersService.callRandomNumber).not.toHaveBeenCalled();

      // Should return firstBallCalled: false
      expect(result).toEqual({
        success: true,
        sessionId: 'session-1',
        autoCallEnabled: true,
        firstBallCalled: false,
      });

      jest.useRealTimers();
    });

    it('default behavior (no option) does not call first ball immediately', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-10T12:00:00.000Z'));

      const { service, prisma, calledNumbersService } = createService({
        sessionLookup: {
          id: 'session-1',
          status: GameStatus.PLAYING,
          autoCallIntervalMs: 7000,
          autoCallEnabled: false,
          gameSlotId: 'slot-1',
          nextAutoCallAt: null,
          calledNumbersCount: 0,
        },
      });

      const result = await service.startAutoCall('session-1');

      // Should use standard path: first ball after interval
      expect(prisma.gameSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: {
          autoCallEnabled: true,
          nextAutoCallAt: new Date('2026-06-10T12:00:07.000Z'),
        },
      });

      // Should NOT call first ball immediately
      expect(calledNumbersService.callRandomNumber).not.toHaveBeenCalled();

      // Should return firstBallCalled: false
      expect(result).toEqual({
        success: true,
        sessionId: 'session-1',
        autoCallEnabled: true,
        firstBallCalled: false,
      });

      jest.useRealTimers();
    });

    it('keeps auto-call enabled even if immediate first ball call fails', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-10T12:00:00.000Z'));

      const { service, prisma, calledNumbersService } = createService({
        sessionLookup: {
          id: 'session-1',
          status: GameStatus.PLAYING,
          autoCallIntervalMs: 7000,
          autoCallEnabled: false,
          gameSlotId: 'slot-1',
          nextAutoCallAt: null,
          calledNumbersCount: 0,
        },
      });

      calledNumbersService.callRandomNumber.mockRejectedValue(
        new Error('Transient database error'),
      );

      const result = await service.startAutoCall('session-1', {
        callFirstImmediately: true,
      });

      // Should still set auto-call enabled
      expect(prisma.gameSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: {
          autoCallEnabled: true,
          nextAutoCallAt: new Date('2026-06-10T12:00:07.000Z'),
        },
      });

      // Should attempt to call first ball
      expect(calledNumbersService.callRandomNumber).toHaveBeenCalledWith(
        'session-1',
      );

      // Should return firstBallCalled: true even though call failed (it's still the intended behavior)
      expect(result).toEqual({
        success: true,
        sessionId: 'session-1',
        autoCallEnabled: true,
        firstBallCalled: true,
      });

      // tick() will retry on next interval
      calledNumbersService.callRandomNumber.mockResolvedValue({
        id: 'called-1',
        gameSessionId: 'session-1',
        letter: 'B',
        number: 7,
        order: 1,
      });

      jest.useRealTimers();
    });
  });
});
