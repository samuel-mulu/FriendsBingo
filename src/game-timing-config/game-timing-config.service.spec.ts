import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_AUTO_CALL_INTERVAL_SECONDS,
  DEFAULT_CARTELA_HOLD_SECONDS,
  DEFAULT_FINISHED_RESULT_DISPLAY_SECONDS,
  DEFAULT_REGISTRATION_DURATION_SECONDS,
  DEFAULT_WINNER_WINDOW_SECONDS,
  DEFAULT_WINNING_PATTERN_DISPLAY_SECONDS,
  GAME_TIMING_CONFIG_ID,
} from './game-timing-config.defaults';
import { GameTimingConfigService } from './game-timing-config.service';

describe('GameTimingConfigService', () => {
  const seededRow = {
    id: GAME_TIMING_CONFIG_ID,
    registrationDurationSeconds: DEFAULT_REGISTRATION_DURATION_SECONDS,
    autoCallIntervalSeconds: DEFAULT_AUTO_CALL_INTERVAL_SECONDS,
    winnerWindowSeconds: DEFAULT_WINNER_WINDOW_SECONDS,
    winnerWindowClaimGraceMs: 750,
    cartelaHoldSeconds: 10,
    finishedResultDisplaySeconds: 60,
    winningPatternDisplaySeconds: 10,
    preparingDisplayMaxSeconds: null,
    missedNumberAnimationMs: 150,
    missedNumberStaggerMaxBalls: 10,
    adminRefreshDebounceMs: 2500,
    adminFallbackPollingSeconds: 5,
    flutterRefetchDebounceMs: 400,
    updatedAt: new Date('2026-06-10T12:00:00.000Z'),
    updatedById: null,
  };

  function createService(options?: {
    row?: typeof seededRow | null;
    upsertResult?: typeof seededRow;
  }) {
    const prisma = {
      gameTimingConfig: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            options?.row === undefined ? seededRow : options.row,
          ),
        upsert: jest
          .fn()
          .mockResolvedValue(options?.upsertResult ?? seededRow),
      },
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(prisma),
      ),
    };

    const auditLogService = {
      create: jest.fn().mockResolvedValue(undefined),
    };

    const service = new GameTimingConfigService(
      prisma as never,
      auditLogService as never,
    );

    return { service, prisma, auditLogService };
  }

  it('returns the seeded admin config from the database', async () => {
    const { service } = createService();

    await expect(service.getAdminConfig()).resolves.toEqual(seededRow);
  });

  it('returns only the player-facing subset', async () => {
    const { service } = createService();

    await expect(service.getPlayerConfig()).resolves.toEqual({
      registrationDurationSeconds: DEFAULT_REGISTRATION_DURATION_SECONDS,
      autoCallIntervalSeconds: DEFAULT_AUTO_CALL_INTERVAL_SECONDS,
      winnerWindowSeconds: DEFAULT_WINNER_WINDOW_SECONDS,
      cartelaHoldSeconds: DEFAULT_CARTELA_HOLD_SECONDS,
      finishedResultDisplaySeconds: DEFAULT_FINISHED_RESULT_DISPLAY_SECONDS,
      winningPatternDisplaySeconds: DEFAULT_WINNING_PATTERN_DISPLAY_SECONDS,
      preparingDisplayMaxSeconds: null,
      missedNumberAnimationMs: 150,
      missedNumberStaggerMaxBalls: 10,
      flutterRefetchDebounceMs: 400,
      serverNow: expect.any(String),
    });
  });

  it('includes a fresh serverNow on player time-config', async () => {
    const { service } = createService();
    const before = Date.now();

    const config = await service.getPlayerConfig();

    expect(config.serverNow).toEqual(expect.any(String));
    expect(Date.parse(config.serverNow)).toBeGreaterThanOrEqual(before);
  });

  it('falls back to code defaults when the singleton row is missing', async () => {
    const { service } = createService({ row: null });

    await expect(service.getRegistrationDurationSeconds()).resolves.toBe(
      DEFAULT_REGISTRATION_DURATION_SECONDS,
    );
  });

  it('updates config, writes audit log, and refreshes cache', async () => {
    const updatedRow = {
      ...seededRow,
      registrationDurationSeconds: 45,
      updatedById: 'admin-1',
      updatedAt: new Date('2026-06-10T12:05:00.000Z'),
    };
    const { service, prisma, auditLogService } = createService({
      upsertResult: updatedRow,
    });

    const result = await service.updateConfig(
      { registrationDurationSeconds: 45 },
      'admin-1',
    );

    expect(prisma.gameTimingConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: GAME_TIMING_CONFIG_ID },
        update: expect.objectContaining({
          registrationDurationSeconds: 45,
          updatedById: 'admin-1',
        }),
      }),
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'admin.time-config.update',
        entity: 'GameTimingConfig',
      }),
    );
    expect(result).toEqual(updatedRow);
    await expect(service.getRegistrationDurationSeconds()).resolves.toBe(45);
  });

  it('rejects empty PATCH payloads', async () => {
    const { service } = createService();

    await expect(service.updateConfig({}, 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
