import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../common/services/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateNotificationConfigDto } from './dto/update-notification-config.dto';
import {
  DEFAULT_PUSH_NOTIFICATIONS_ENABLED,
  NOTIFICATION_CONFIG_ID,
} from './notification-config.defaults';
import {
  AdminNotificationConfigResponse,
  NotificationConfigRecord,
} from './notification-config.types';

const CACHE_TTL_MS = 30_000;

const notificationConfigSelect = {
  id: true,
  pushNotificationsEnabled: true,
  updatedAt: true,
  updatedById: true,
} satisfies Prisma.NotificationConfigSelect;

@Injectable()
export class NotificationConfigService {
  private cachedConfig: NotificationConfigRecord | null = null;
  private cacheExpiresAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getAdminConfig(): Promise<AdminNotificationConfigResponse> {
    const config = await this.getConfig();
    return this.toAdminResponse(config);
  }

  async isPushNotificationsEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return config.pushNotificationsEnabled;
  }

  async updateConfig(
    dto: UpdateNotificationConfigDto,
    actorId: string,
  ): Promise<AdminNotificationConfigResponse> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.notificationConfig.upsert({
        where: { id: NOTIFICATION_CONFIG_ID },
        create: {
          id: NOTIFICATION_CONFIG_ID,
          pushNotificationsEnabled: dto.pushNotificationsEnabled,
          updatedById: actorId,
        },
        update: {
          pushNotificationsEnabled: dto.pushNotificationsEnabled,
          updatedById: actorId,
        },
        select: notificationConfigSelect,
      });

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.notification_config.update',
        entity: 'NotificationConfig',
        entityId: row.id,
        metadata: {
          pushNotificationsEnabled: dto.pushNotificationsEnabled,
        },
      });

      return row;
    });

    this.setCache(updated);
    return this.toAdminResponse(updated);
  }

  private async getConfig(): Promise<NotificationConfigRecord> {
    const now = Date.now();
    if (this.cachedConfig && now < this.cacheExpiresAt) {
      return this.cachedConfig;
    }

    try {
      const row = await this.prisma.notificationConfig.findUnique({
        where: { id: NOTIFICATION_CONFIG_ID },
        select: notificationConfigSelect,
      });

      const config = row ?? this.getFallbackConfig();
      this.setCache(config);
      return config;
    } catch (error) {
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

  private setCache(config: NotificationConfigRecord) {
    this.cachedConfig = config;
    this.cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  }

  private getFallbackConfig(): NotificationConfigRecord {
    return {
      id: NOTIFICATION_CONFIG_ID,
      pushNotificationsEnabled: DEFAULT_PUSH_NOTIFICATIONS_ENABLED,
      updatedAt: new Date(0),
      updatedById: null,
    };
  }

  private toAdminResponse(
    config: NotificationConfigRecord,
  ): AdminNotificationConfigResponse {
    return {
      id: config.id,
      pushNotificationsEnabled: config.pushNotificationsEnabled,
      updatedAt: config.updatedAt.toISOString(),
      updatedById: config.updatedById,
    };
  }
}
