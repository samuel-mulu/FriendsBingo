import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_CARTELA_HOLD_SECONDS,
  DEFAULT_REGISTRATION_DURATION_SECONDS,
  GAME_TIMING_CONFIG_ID,
} from './game-timing-config.defaults';
import { GameTimingConfigService } from './game-timing-config.service';

describe('GameTimingConfigService', () => {
  const seededRow = {
    id: GAME_TIMING_CONFIG_ID,
    registrationDurationSeconds: 60,
    autoCallIntervalSeconds: 7,
    winnerWindowSeconds: 15,
    cartelaHoldSeconds: 10,
    finishedResultDisplaySeconds: 3,
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
      autoCallIntervalSeconds: 7,
      cartelaHoldSeconds: DEFAULT_CARTELA_HOLD_SECONDS,
      finishedResultDisplaySeconds: 3,
      preparingDisplayMaxSeconds: null,
      missedNumberAnimationMs: 150,
      missedNumberStaggerMaxBalls: 10,
      flutterRefetchDebounceMs: 400,
    });
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
