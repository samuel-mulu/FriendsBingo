import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../common/services/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  APP_SUPPORT_CONFIG_ID,
  DEFAULT_SUPPORT_PHONE_NUMBER_1,
  DEFAULT_SUPPORT_PHONE_NUMBER_2,
  DEFAULT_SUPPORT_TELEGRAM_USERNAME,
  DEFAULT_SUPPORT_TERMS_BODY,
} from './app-support-config.defaults';
import {
  AdminAppSupportConfigResponse,
  AppSupportConfigRecord,
  PlayerAppSupportConfigResponse,
} from './app-support-config.types';
import { UpdateAppSupportConfigDto } from './dto/update-app-support-config.dto';

const CACHE_TTL_MS = 30_000;

const appSupportConfigSelect = {
  id: true,
  phoneNumber1: true,
  phoneNumber2: true,
  telegramUsername: true,
  termsBody: true,
  updatedAt: true,
  updatedById: true,
} satisfies Prisma.AppSupportConfigSelect;

@Injectable()
export class AppSupportConfigService {
  private cachedConfig: AppSupportConfigRecord | null = null;
  private cacheExpiresAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getAdminConfig(): Promise<AdminAppSupportConfigResponse> {
    const config = await this.getConfig();
    return this.toAdminResponse(config);
  }

  async getPlayerConfig(): Promise<PlayerAppSupportConfigResponse> {
    const config = await this.getConfig();
    return {
      phoneNumber1: config.phoneNumber1,
      phoneNumber2: config.phoneNumber2,
      telegramUsername: config.telegramUsername,
      termsBody: config.termsBody,
    };
  }

  async updateConfig(
    dto: UpdateAppSupportConfigDto,
    actorId: string,
  ): Promise<AdminAppSupportConfigResponse> {
    if (
      dto.phoneNumber1 === undefined &&
      dto.phoneNumber2 === undefined &&
      dto.telegramUsername === undefined &&
      dto.termsBody === undefined
    ) {
      throw new BadRequestException(
        'Provide at least one support setting to update.',
      );
    }

    const current = await this.getConfig();
    const phoneNumber1 = this.normalizePhone(
      dto.phoneNumber1 ?? current.phoneNumber1,
    );
    const phoneNumber2 = this.normalizePhoneOptional(
      dto.phoneNumber2 ?? current.phoneNumber2,
    );
    const telegramUsername = this.normalizeTelegramUsername(
      dto.telegramUsername ?? current.telegramUsername,
    );
    const termsBody = (dto.termsBody ?? current.termsBody).trim();

    if (!phoneNumber1) {
      throw new BadRequestException('phoneNumber1 is required.');
    }
    if (!telegramUsername) {
      throw new BadRequestException('telegramUsername is required.');
    }
    if (!termsBody) {
      throw new BadRequestException('termsBody is required.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.appSupportConfig.upsert({
        where: { id: APP_SUPPORT_CONFIG_ID },
        create: {
          id: APP_SUPPORT_CONFIG_ID,
          phoneNumber1,
          phoneNumber2,
          telegramUsername,
          termsBody,
          updatedById: actorId,
        },
        update: {
          phoneNumber1,
          phoneNumber2,
          telegramUsername,
          termsBody,
          updatedById: actorId,
        },
        select: appSupportConfigSelect,
      });

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.support_config.update',
        entity: 'AppSupportConfig',
        entityId: row.id,
        metadata: {
          phoneNumber1,
          phoneNumber2,
          telegramUsername,
          termsBodyLength: termsBody.length,
        },
      });

      return row;
    });

    this.setCache(updated);
    return this.toAdminResponse(updated);
  }

  private async getConfig(): Promise<AppSupportConfigRecord> {
    const now = Date.now();
    if (this.cachedConfig && now < this.cacheExpiresAt) {
      return this.cachedConfig;
    }

    try {
      const row = await this.prisma.appSupportConfig.findUnique({
        where: { id: APP_SUPPORT_CONFIG_ID },
        select: appSupportConfigSelect,
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

  private setCache(config: AppSupportConfigRecord) {
    this.cachedConfig = config;
    this.cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  }

  private getFallbackConfig(): AppSupportConfigRecord {
    return {
      id: APP_SUPPORT_CONFIG_ID,
      phoneNumber1: DEFAULT_SUPPORT_PHONE_NUMBER_1,
      phoneNumber2: DEFAULT_SUPPORT_PHONE_NUMBER_2,
      telegramUsername: DEFAULT_SUPPORT_TELEGRAM_USERNAME,
      termsBody: DEFAULT_SUPPORT_TERMS_BODY,
      updatedAt: new Date(0),
      updatedById: null,
    };
  }

  private toAdminResponse(
    config: AppSupportConfigRecord,
  ): AdminAppSupportConfigResponse {
    return {
      id: config.id,
      phoneNumber1: config.phoneNumber1,
      phoneNumber2: config.phoneNumber2,
      telegramUsername: config.telegramUsername,
      termsBody: config.termsBody,
      updatedAt: config.updatedAt.toISOString(),
      updatedById: config.updatedById,
    };
  }

  private normalizePhone(value: string): string {
    return value.trim();
  }

  private normalizePhoneOptional(value: string): string {
    return value.trim();
  }

  private normalizeTelegramUsername(value: string): string {
    return value.trim().replace(/^@+/, '');
  }
}
