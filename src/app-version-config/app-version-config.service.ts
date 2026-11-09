import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../common/services/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  APP_VERSION_CONFIG_ID,
  DEFAULT_APP_VERSION_RELEASE_NOTES,
} from './app-version-config.defaults';
import {
  AdminAppVersionConfigResponse,
  AppVersionConfigRecord,
} from './app-version-config.types';
import { UpdateAppVersionConfigDto } from './dto/update-app-version-config.dto';

const CACHE_TTL_MS = 30_000;

const appVersionConfigSelect = {
  id: true,
  releaseNotes: true,
  updatedAt: true,
  updatedById: true,
} satisfies Prisma.AppVersionConfigSelect;

@Injectable()
export class AppVersionConfigService {
  private cachedConfig: AppVersionConfigRecord | null = null;
  private cacheExpiresAt = 0;
  private cachedHasDbRow = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getAdminConfig(): Promise<AdminAppVersionConfigResponse> {
    const config = await this.getConfig();
    return this.toAdminResponse(config);
  }

  /**
   * Returns DB release notes when a row exists; otherwise null so callers
   * can fall back to ANDROID_RELEASE_NOTES env.
   */
  async getReleaseNotes(): Promise<string | null> {
    await this.getConfig();
    if (!this.cachedHasDbRow) {
      return null;
    }
    return this.cachedConfig?.releaseNotes ?? null;
  }

  async updateConfig(
    dto: UpdateAppVersionConfigDto,
    actorId: string,
  ): Promise<AdminAppVersionConfigResponse> {
    const releaseNotes = dto.releaseNotes.trim();

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.appVersionConfig.upsert({
        where: { id: APP_VERSION_CONFIG_ID },
        create: {
          id: APP_VERSION_CONFIG_ID,
          releaseNotes,
          updatedById: actorId,
        },
        update: {
          releaseNotes,
          updatedById: actorId,
        },
        select: appVersionConfigSelect,
      });

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.app_version_config.update',
        entity: 'AppVersionConfig',
        entityId: row.id,
        metadata: {
          releaseNotesLength: releaseNotes.length,
        },
      });

      return row;
    });

    this.setCache(updated, true);
    return this.toAdminResponse(updated);
  }

  private async getConfig(): Promise<AppVersionConfigRecord> {
    const now = Date.now();
    if (this.cachedConfig && now < this.cacheExpiresAt) {
      return this.cachedConfig;
    }

    try {
      const row = await this.prisma.appVersionConfig.findUnique({
        where: { id: APP_VERSION_CONFIG_ID },
        select: appVersionConfigSelect,
      });

      if (row) {
        this.setCache(row, true);
        return row;
      }

      const fallback = this.getFallbackConfig();
      this.setCache(fallback, false);
      return fallback;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2021'
      ) {
        const fallback = this.getFallbackConfig();
        this.setCache(fallback, false);
        return fallback;
      }

      throw error;
    }
  }

  private setCache(config: AppVersionConfigRecord, hasDbRow: boolean) {
    this.cachedConfig = config;
    this.cachedHasDbRow = hasDbRow;
    this.cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  }

  private getFallbackConfig(): AppVersionConfigRecord {
    return {
      id: APP_VERSION_CONFIG_ID,
      releaseNotes: DEFAULT_APP_VERSION_RELEASE_NOTES,
      updatedAt: new Date(0),
      updatedById: null,
    };
  }

  private toAdminResponse(
    config: AppVersionConfigRecord,
  ): AdminAppVersionConfigResponse {
    return {
      id: config.id,
      releaseNotes: config.releaseNotes,
      updatedAt: config.updatedAt.toISOString(),
      updatedById: config.updatedById,
    };
  }
}
