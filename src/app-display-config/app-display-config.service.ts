import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, WinnerPhoneDisplayMode } from '@prisma/client';
import { AuditLogService } from '../common/services/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  APP_DISPLAY_CONFIG_ID,
  DEFAULT_BIG_GAME_PROMOTION_CARD_ENABLED,
  DEFAULT_WINNER_PHONE_DISPLAY_MODE,
} from './app-display-config.defaults';
import {
  AdminAppDisplayConfigResponse,
  AppDisplayConfigRecord,
  PlayerAppDisplayConfigResponse,
} from './app-display-config.types';
import { UpdateAppDisplayConfigDto } from './dto/update-app-display-config.dto';

const CACHE_TTL_MS = 30_000;

const appDisplayConfigSelect = {
  id: true,
  winnerPhoneDisplayMode: true,
  bigGamePromotionCardEnabled: true,
  updatedAt: true,
  updatedById: true,
} satisfies Prisma.AppDisplayConfigSelect;

@Injectable()
export class AppDisplayConfigService {
  private cachedConfig: AppDisplayConfigRecord | null = null;
  private cacheExpiresAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getAdminConfig(): Promise<AdminAppDisplayConfigResponse> {
    const config = await this.getConfig();
    return this.toAdminResponse(config);
  }

  async getPlayerConfig(): Promise<PlayerAppDisplayConfigResponse> {
    const config = await this.getConfig();
    return {
      bigGamePromotionCardEnabled: config.bigGamePromotionCardEnabled,
    };
  }

  async getWinnerPhoneDisplayMode(): Promise<WinnerPhoneDisplayMode> {
    const config = await this.getConfig();
    return config.winnerPhoneDisplayMode;
  }

  async updateConfig(
    dto: UpdateAppDisplayConfigDto,
    actorId: string,
  ): Promise<AdminAppDisplayConfigResponse> {
    if (
      dto.winnerPhoneDisplayMode === undefined &&
      dto.bigGamePromotionCardEnabled === undefined
    ) {
      throw new BadRequestException(
        'Provide at least one display setting to update.',
      );
    }

    const current = await this.getConfig();
    const winnerPhoneDisplayMode =
      dto.winnerPhoneDisplayMode ?? current.winnerPhoneDisplayMode;
    const bigGamePromotionCardEnabled =
      dto.bigGamePromotionCardEnabled ?? current.bigGamePromotionCardEnabled;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.appDisplayConfig.upsert({
        where: { id: APP_DISPLAY_CONFIG_ID },
        create: {
          id: APP_DISPLAY_CONFIG_ID,
          winnerPhoneDisplayMode,
          bigGamePromotionCardEnabled,
          updatedById: actorId,
        },
        update: {
          winnerPhoneDisplayMode,
          bigGamePromotionCardEnabled,
          updatedById: actorId,
        },
        select: appDisplayConfigSelect,
      });

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.display_config.update',
        entity: 'AppDisplayConfig',
        entityId: row.id,
        metadata: {
          winnerPhoneDisplayMode,
          bigGamePromotionCardEnabled,
        },
      });

      return row;
    });

    this.setCache(updated);
    return this.toAdminResponse(updated);
  }

  private async getConfig(): Promise<AppDisplayConfigRecord> {
    const now = Date.now();
    if (this.cachedConfig && now < this.cacheExpiresAt) {
      return this.cachedConfig;
    }

    try {
      const row = await this.prisma.appDisplayConfig.findUnique({
        where: { id: APP_DISPLAY_CONFIG_ID },
        select: appDisplayConfigSelect,
      });

      const config = row ?? this.getFallbackConfig();
      this.setCache(config);
      return config;
    } catch (error) {
      // Table missing before migrate deploy — keep player/admin flows alive.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2021'
      ) {
        const fallback = this.getFallbackConfig();
        this.setCache(fallback);
        return fallback;
      }

      throw error;
    }
  }

  private setCache(config: AppDisplayConfigRecord) {
    this.cachedConfig = config;
    this.cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  }

  private getFallbackConfig(): AppDisplayConfigRecord {
    return {
      id: APP_DISPLAY_CONFIG_ID,
      winnerPhoneDisplayMode: DEFAULT_WINNER_PHONE_DISPLAY_MODE,
      bigGamePromotionCardEnabled: DEFAULT_BIG_GAME_PROMOTION_CARD_ENABLED,
      updatedAt: new Date(0),
      updatedById: null,
    };
  }

  private toAdminResponse(
    config: AppDisplayConfigRecord,
  ): AdminAppDisplayConfigResponse {
    return {
      id: config.id,
      winnerPhoneDisplayMode: config.winnerPhoneDisplayMode,
      bigGamePromotionCardEnabled: config.bigGamePromotionCardEnabled,
      updatedAt: config.updatedAt.toISOString(),
      updatedById: config.updatedById,
    };
  }
}
