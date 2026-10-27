import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../common/services/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateRegistrationCashbackConfigDto } from './dto/update-registration-cashback-config.dto';
import {
  DEFAULT_REGISTRATION_CASHBACK_TIERS,
  REGISTRATION_CASHBACK_CONFIG_ID,
} from './registration-cashback.defaults';
import {
  parseTiersFromJson,
  tiersToJson,
  validateTierOrdering,
} from './registration-cashback.tiers.util';
import { RegistrationCashbackTier } from './registration-cashback.types';

const CACHE_TTL_MS = 30_000;

const configSelect = {
  id: true,
  enabled: true,
  tiers: true,
  updatedAt: true,
  updatedById: true,
} satisfies Prisma.RegistrationCashbackConfigSelect;

type ConfigRecord = Prisma.RegistrationCashbackConfigGetPayload<{
  select: typeof configSelect;
}>;

export type AdminRegistrationCashbackConfigResponse = {
  id: string;
  enabled: boolean;
  tiers: RegistrationCashbackTier[];
  updatedAt: string;
  updatedById: string | null;
};

export type PlayerRegistrationCashbackConfigResponse = {
  enabled: boolean;
  tiers: RegistrationCashbackTier[];
};

@Injectable()
export class RegistrationCashbackConfigService {
  private cachedConfig: {
    enabled: boolean;
    tiers: RegistrationCashbackTier[];
  } | null = null;
  private cacheExpiresAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getAdminConfig(): Promise<AdminRegistrationCashbackConfigResponse> {
    const row = await this.loadConfigRow();
    return this.toAdminResponse(row);
  }

  async getPlayerConfig(): Promise<PlayerRegistrationCashbackConfigResponse> {
    const { enabled, tiers } = await this.getEffectiveConfig();
    return { enabled, tiers };
  }

  async getEffectiveConfig(): Promise<{
    enabled: boolean;
    tiers: RegistrationCashbackTier[];
  }> {
    const now = Date.now();
    if (this.cachedConfig && now < this.cacheExpiresAt) {
      return this.cachedConfig;
    }

    const row = await this.loadConfigRow();
    const tiers = parseTiersFromJson(row.tiers);
    const effective = { enabled: row.enabled, tiers };
    this.cachedConfig = effective;
    this.cacheExpiresAt = now + CACHE_TTL_MS;
    return effective;
  }

  async updateConfig(
    dto: UpdateRegistrationCashbackConfigDto,
    actorId: string,
  ): Promise<AdminRegistrationCashbackConfigResponse> {
    const current = await this.loadConfigRow();
    const nextTiers =
      dto.tiers !== undefined
        ? dto.tiers.map((tier) => ({
            minCartelasInSession: tier.minCartelasInSession,
            rewardEtb: tier.rewardEtb.trim(),
          }))
        : parseTiersFromJson(current.tiers);
    validateTierOrdering(nextTiers);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.registrationCashbackConfig.upsert({
        where: { id: REGISTRATION_CASHBACK_CONFIG_ID },
        create: {
          id: REGISTRATION_CASHBACK_CONFIG_ID,
          enabled: dto.enabled ?? false,
          tiers: tiersToJson(nextTiers),
          updatedById: actorId,
        },
        update: {
          ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
          tiers: tiersToJson(nextTiers),
          updatedById: actorId,
        },
        select: configSelect,
      });

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.registration_cashback_config.update',
        entity: 'RegistrationCashbackConfig',
        entityId: row.id,
        metadata: {
          enabled: row.enabled,
          tierCount: nextTiers.length,
        },
      });

      return row;
    });

    this.cachedConfig = null;
    return this.toAdminResponse(updated);
  }

  private async loadConfigRow(): Promise<ConfigRecord> {
    try {
      const row = await this.prisma.registrationCashbackConfig.findUnique({
        where: { id: REGISTRATION_CASHBACK_CONFIG_ID },
        select: configSelect,
      });
      if (row) {
        return row;
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2021'
      ) {
        return this.fallbackRow();
      }
      throw error;
    }

    return this.fallbackRow();
  }

  private fallbackRow(): ConfigRecord {
    return {
      id: REGISTRATION_CASHBACK_CONFIG_ID,
      enabled: false,
      tiers: tiersToJson([...DEFAULT_REGISTRATION_CASHBACK_TIERS]) as Prisma.JsonValue,
      updatedAt: new Date(0),
      updatedById: null,
    };
  }

  private toAdminResponse(
    row: ConfigRecord,
  ): AdminRegistrationCashbackConfigResponse {
    return {
      id: row.id,
      enabled: row.enabled,
      tiers: parseTiersFromJson(row.tiers),
      updatedAt: row.updatedAt.toISOString(),
      updatedById: row.updatedById,
    };
  }
}
