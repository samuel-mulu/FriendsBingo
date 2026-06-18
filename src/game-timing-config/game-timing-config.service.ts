import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../common/services/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateGameTimingConfigDto } from './dto/update-game-timing-config.dto';
import {
  DEFAULT_ADMIN_FALLBACK_POLLING_SECONDS,
  DEFAULT_ADMIN_REFRESH_DEBOUNCE_MS,
  DEFAULT_AUTO_CALL_INTERVAL_SECONDS,
  DEFAULT_CARTELA_HOLD_SECONDS,
  DEFAULT_FINISHED_RESULT_DISPLAY_SECONDS,
  DEFAULT_FLUTTER_REFETCH_DEBOUNCE_MS,
  DEFAULT_MISSED_NUMBER_ANIMATION_MS,
  DEFAULT_MISSED_NUMBER_STAGGER_MAX_BALLS,
  DEFAULT_REGISTRATION_DURATION_SECONDS,
  DEFAULT_WINNER_WINDOW_SECONDS,
  DEFAULT_WINNER_WINDOW_CLAIM_GRACE_MS,
  DEFAULT_WINNING_PATTERN_DISPLAY_SECONDS,
  GAME_TIMING_CONFIG_ID,
} from './game-timing-config.defaults';
import {
  AdminGameTimingConfigResponse,
  GameTimingConfigRecord,
  PlayerGameTimingConfigResponse,
} from './game-timing-config.types';

const CACHE_TTL_MS = 30_000;

const gameTimingConfigSelect = {
  id: true,
  registrationDurationSeconds: true,
  autoCallIntervalSeconds: true,
  winnerWindowSeconds: true,
  winnerWindowClaimGraceMs: true,
  cartelaHoldSeconds: true,
  finishedResultDisplaySeconds: true,
  winningPatternDisplaySeconds: true,
  preparingDisplayMaxSeconds: true,
  missedNumberAnimationMs: true,
  missedNumberStaggerMaxBalls: true,
  adminRefreshDebounceMs: true,
  adminFallbackPollingSeconds: true,
  flutterRefetchDebounceMs: true,
  updatedAt: true,
  updatedById: true,
} satisfies Prisma.GameTimingConfigSelect;

@Injectable()
export class GameTimingConfigService {
  private cachedConfig: GameTimingConfigRecord | null = null;
  private cacheExpiresAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getAdminConfig(): Promise<AdminGameTimingConfigResponse> {
    return this.getConfig();
  }

  async getPlayerConfig(): Promise<PlayerGameTimingConfigResponse> {
    const config = await this.getConfig();
    return this.toPlayerSubset(config);
  }

  async getRegistrationDurationSeconds(): Promise<number> {
    const config = await this.getConfig();
    return config.registrationDurationSeconds;
  }

  async getAutoCallIntervalSeconds(): Promise<number> {
    const config = await this.getConfig();
    return config.autoCallIntervalSeconds;
  }

  async getAutoCallIntervalMs(): Promise<number> {
    const seconds = await this.getAutoCallIntervalSeconds();
    return seconds * 1000;
  }

  async getWinnerWindowDurationMs(): Promise<number> {
    const config = await this.getConfig();
    return config.winnerWindowSeconds * 1000;
  }

  async getWinnerWindowClaimGraceMs(): Promise<number> {
    const config = await this.getConfig();
    return config.winnerWindowClaimGraceMs;
  }

  async getCartelaHoldMs(): Promise<number> {
    const config = await this.getConfig();
    return config.cartelaHoldSeconds * 1000;
  }

  async getFinishedResultDisplaySeconds(): Promise<number> {
    const config = await this.getConfig();
    return Math.max(
      config.finishedResultDisplaySeconds,
      DEFAULT_FINISHED_RESULT_DISPLAY_SECONDS,
    );
  }

  async updateConfig(
    dto: UpdateGameTimingConfigDto,
    actorId: string,
  ): Promise<AdminGameTimingConfigResponse> {
    if (!Object.values(dto).some((value) => value !== undefined)) {
      throw new BadRequestException('At least one timing field must be provided');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.gameTimingConfig.upsert({
        where: { id: GAME_TIMING_CONFIG_ID },
        create: {
          id: GAME_TIMING_CONFIG_ID,
          ...this.buildCreateData(dto),
          updatedById: actorId,
        },
        update: {
          ...(this.buildUpdateData(dto) as Prisma.GameTimingConfigUncheckedUpdateInput),
          updatedById: actorId,
        },
        select: gameTimingConfigSelect,
      });

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.time-config.update',
        entity: 'GameTimingConfig',
        entityId: row.id,
        metadata: { ...dto },
      });

      return row;
    });

    this.setCache(updated);
    return updated;
  }

  private async getConfig(): Promise<GameTimingConfigRecord> {
    const now = Date.now();
    if (this.cachedConfig && now < this.cacheExpiresAt) {
      return this.cachedConfig;
    }

    const row = await this.prisma.gameTimingConfig.findUnique({
      where: { id: GAME_TIMING_CONFIG_ID },
      select: gameTimingConfigSelect,
    });

    const config = row ?? this.getFallbackConfig();
    this.setCache(config);
    return config;
  }

  private setCache(config: GameTimingConfigRecord) {
    this.cachedConfig = config;
    this.cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  }

  private getFallbackConfig(): GameTimingConfigRecord {
    return {
      id: GAME_TIMING_CONFIG_ID,
      registrationDurationSeconds: DEFAULT_REGISTRATION_DURATION_SECONDS,
      autoCallIntervalSeconds: DEFAULT_AUTO_CALL_INTERVAL_SECONDS,
      winnerWindowSeconds: DEFAULT_WINNER_WINDOW_SECONDS,
      winnerWindowClaimGraceMs: DEFAULT_WINNER_WINDOW_CLAIM_GRACE_MS,
      cartelaHoldSeconds: DEFAULT_CARTELA_HOLD_SECONDS,
      finishedResultDisplaySeconds: DEFAULT_FINISHED_RESULT_DISPLAY_SECONDS,
      winningPatternDisplaySeconds: DEFAULT_WINNING_PATTERN_DISPLAY_SECONDS,
      preparingDisplayMaxSeconds: null,
      missedNumberAnimationMs: DEFAULT_MISSED_NUMBER_ANIMATION_MS,
      missedNumberStaggerMaxBalls: DEFAULT_MISSED_NUMBER_STAGGER_MAX_BALLS,
      adminRefreshDebounceMs: DEFAULT_ADMIN_REFRESH_DEBOUNCE_MS,
      adminFallbackPollingSeconds: DEFAULT_ADMIN_FALLBACK_POLLING_SECONDS,
      flutterRefetchDebounceMs: DEFAULT_FLUTTER_REFETCH_DEBOUNCE_MS,
      updatedAt: new Date(0),
      updatedById: null,
    };
  }

  private toPlayerSubset(
    config: GameTimingConfigRecord,
  ): PlayerGameTimingConfigResponse {
    const serverNow = new Date().toISOString();
    return {
      registrationDurationSeconds: config.registrationDurationSeconds,
      autoCallIntervalSeconds: config.autoCallIntervalSeconds,
      winnerWindowSeconds: config.winnerWindowSeconds,
      cartelaHoldSeconds: config.cartelaHoldSeconds,
      finishedResultDisplaySeconds: config.finishedResultDisplaySeconds,
      winningPatternDisplaySeconds: config.winningPatternDisplaySeconds,
      preparingDisplayMaxSeconds: config.preparingDisplayMaxSeconds,
      missedNumberAnimationMs: config.missedNumberAnimationMs,
      missedNumberStaggerMaxBalls: config.missedNumberStaggerMaxBalls,
      flutterRefetchDebounceMs: config.flutterRefetchDebounceMs,
      serverNow,
    };
  }

  private buildCreateData(
    dto: UpdateGameTimingConfigDto,
  ): Omit<
    Prisma.GameTimingConfigCreateInput,
    'id' | 'updatedBy' | 'updatedById'
  > {
    return {
      registrationDurationSeconds:
        dto.registrationDurationSeconds ?? DEFAULT_REGISTRATION_DURATION_SECONDS,
      autoCallIntervalSeconds:
        dto.autoCallIntervalSeconds ?? DEFAULT_AUTO_CALL_INTERVAL_SECONDS,
      winnerWindowSeconds:
        dto.winnerWindowSeconds ?? DEFAULT_WINNER_WINDOW_SECONDS,
      winnerWindowClaimGraceMs:
        dto.winnerWindowClaimGraceMs ?? DEFAULT_WINNER_WINDOW_CLAIM_GRACE_MS,
      cartelaHoldSeconds: dto.cartelaHoldSeconds ?? DEFAULT_CARTELA_HOLD_SECONDS,
      finishedResultDisplaySeconds:
        dto.finishedResultDisplaySeconds ??
        DEFAULT_FINISHED_RESULT_DISPLAY_SECONDS,
      winningPatternDisplaySeconds:
        dto.winningPatternDisplaySeconds ??
        DEFAULT_WINNING_PATTERN_DISPLAY_SECONDS,
      preparingDisplayMaxSeconds: dto.preparingDisplayMaxSeconds ?? null,
      missedNumberAnimationMs:
        dto.missedNumberAnimationMs ?? DEFAULT_MISSED_NUMBER_ANIMATION_MS,
      missedNumberStaggerMaxBalls:
        dto.missedNumberStaggerMaxBalls ??
        DEFAULT_MISSED_NUMBER_STAGGER_MAX_BALLS,
      adminRefreshDebounceMs:
        dto.adminRefreshDebounceMs ?? DEFAULT_ADMIN_REFRESH_DEBOUNCE_MS,
      adminFallbackPollingSeconds:
        dto.adminFallbackPollingSeconds ??
        DEFAULT_ADMIN_FALLBACK_POLLING_SECONDS,
      flutterRefetchDebounceMs:
        dto.flutterRefetchDebounceMs ?? DEFAULT_FLUTTER_REFETCH_DEBOUNCE_MS,
    };
  }

  private buildUpdateData(
    dto: UpdateGameTimingConfigDto,
  ): Prisma.GameTimingConfigUpdateInput {
    const data: Prisma.GameTimingConfigUpdateInput = {};

    if (dto.registrationDurationSeconds !== undefined) {
      data.registrationDurationSeconds = dto.registrationDurationSeconds;
    }
    if (dto.autoCallIntervalSeconds !== undefined) {
      data.autoCallIntervalSeconds = dto.autoCallIntervalSeconds;
    }
    if (dto.winnerWindowSeconds !== undefined) {
      data.winnerWindowSeconds = dto.winnerWindowSeconds;
    }
    if (dto.winnerWindowClaimGraceMs !== undefined) {
      data.winnerWindowClaimGraceMs = dto.winnerWindowClaimGraceMs;
    }
    if (dto.cartelaHoldSeconds !== undefined) {
      data.cartelaHoldSeconds = dto.cartelaHoldSeconds;
    }
    if (dto.finishedResultDisplaySeconds !== undefined) {
      data.finishedResultDisplaySeconds = dto.finishedResultDisplaySeconds;
    }
    if (dto.winningPatternDisplaySeconds !== undefined) {
      data.winningPatternDisplaySeconds = dto.winningPatternDisplaySeconds;
    }
    if (dto.preparingDisplayMaxSeconds !== undefined) {
      data.preparingDisplayMaxSeconds = dto.preparingDisplayMaxSeconds;
    }
    if (dto.missedNumberAnimationMs !== undefined) {
      data.missedNumberAnimationMs = dto.missedNumberAnimationMs;
    }
    if (dto.missedNumberStaggerMaxBalls !== undefined) {
      data.missedNumberStaggerMaxBalls = dto.missedNumberStaggerMaxBalls;
    }
    if (dto.adminRefreshDebounceMs !== undefined) {
      data.adminRefreshDebounceMs = dto.adminRefreshDebounceMs;
    }
    if (dto.adminFallbackPollingSeconds !== undefined) {
      data.adminFallbackPollingSeconds = dto.adminFallbackPollingSeconds;
    }
    if (dto.flutterRefetchDebounceMs !== undefined) {
      data.flutterRefetchDebounceMs = dto.flutterRefetchDebounceMs;
    }

    return data;
  }
}
