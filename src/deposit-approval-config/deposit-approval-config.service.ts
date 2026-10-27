import { BadRequestException, Injectable } from '@nestjs/common';
import { DepositApprovalMode, PaymentProvider, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/services/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateDepositApprovalConfigDto } from './dto/update-deposit-approval-config.dto';
import {
  ALL_DEPOSIT_PROVIDERS,
  AdminDepositApprovalConfigResponse,
  DepositApprovalConfigRecord,
  PlayerDepositProviderApprovalConfig,
  STANDARD_APPROVAL_MODES,
  TELEBIRR_APPROVAL_MODES,
  fromApiApprovalMode,
  toApiApprovalMode,
} from './deposit-approval-config.types';

const CACHE_TTL_MS = 30_000;

const depositApprovalConfigSelect = {
  provider: true,
  enabled: true,
  approvalMode: true,
  fallbackThreshold: true,
  fallbackWindowMinutes: true,
  fallbackDurationMinutes: true,
  fallbackUntil: true,
  fallbackReason: true,
  updatedAt: true,
  updatedById: true,
} satisfies Prisma.DepositApprovalConfigSelect;

@Injectable()
export class DepositApprovalConfigService {
  private cachedConfigs: DepositApprovalConfigRecord[] | null = null;
  private cacheExpiresAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getAdminConfig(): Promise<AdminDepositApprovalConfigResponse> {
    const configs = await this.getAllConfigs();
    const now = Date.now();
    return {
      providers: configs.map((config) => {
        const isFallbackActive =
          config.approvalMode === DepositApprovalMode.LOCAL_WITH_FALLBACK &&
          Boolean(config.fallbackUntil && now < config.fallbackUntil.getTime());

        return {
          provider: config.provider,
          enabled: config.enabled,
          approvalMode: toApiApprovalMode(config.approvalMode),
          allowedModes: this.getAllowedModes(config.provider).map(
            toApiApprovalMode,
          ),
          fallbackThreshold: config.fallbackThreshold,
          fallbackWindowMinutes: config.fallbackWindowMinutes,
          fallbackDurationMinutes: config.fallbackDurationMinutes,
          fallbackUntil: config.fallbackUntil?.toISOString() ?? null,
          fallbackReason: config.fallbackReason,
          isFallbackActive,
          updatedAt: config.updatedAt.toISOString(),
          updatedById: config.updatedById,
        };
      }),
    };
  }

  async getPlayerProviderConfigs(): Promise<
    PlayerDepositProviderApprovalConfig[]
  > {
    const configs = await this.getAllConfigs();
    const now = Date.now();
    return configs.map((config) => {
      let resolvedMode = config.approvalMode;
      let isFallbackActive = false;
      let fallbackUntil: string | null = null;

      if (config.approvalMode === DepositApprovalMode.LOCAL_WITH_FALLBACK) {
        if (config.fallbackUntil && now < config.fallbackUntil.getTime()) {
          resolvedMode = DepositApprovalMode.AUTOMATIC;
          isFallbackActive = true;
          fallbackUntil = config.fallbackUntil.toISOString();
        } else {
          resolvedMode = DepositApprovalMode.LOCAL;
        }
      }

      return {
        key: config.provider,
        enabled: config.enabled,
        approvalMode: toApiApprovalMode(resolvedMode),
        configuredApprovalMode: toApiApprovalMode(config.approvalMode),
        isFallbackActive,
        fallbackUntil,
      };
    });
  }

  async getMode(provider: PaymentProvider): Promise<DepositApprovalMode> {
    const config = await this.getProviderConfig(provider);
    if (!config.enabled) {
      throw new BadRequestException(
        `${provider} deposits are currently unavailable.`,
      );
    }

    if (config.approvalMode === DepositApprovalMode.LOCAL_WITH_FALLBACK) {
      const now = Date.now();
      if (config.fallbackUntil && now < config.fallbackUntil.getTime()) {
        return DepositApprovalMode.AUTOMATIC;
      }
      return DepositApprovalMode.LOCAL;
    }

    return config.approvalMode;
  }

  async recordLookupFailure(params: {
    userId?: string;
    transactionRef?: string;
    reason?: string;
  }): Promise<{ tripped: boolean; fallbackUntil?: Date }> {
    const config = await this.getProviderConfig(PaymentProvider.TELEBIRR);
    if (config.approvalMode !== DepositApprovalMode.LOCAL_WITH_FALLBACK) {
      return { tripped: false };
    }

    const now = new Date();

    // TIMER IMMUTABILITY: If breaker is already active in OPEN state, NEVER extend fallbackUntil!
    if (
      config.fallbackUntil &&
      now.getTime() < config.fallbackUntil.getTime()
    ) {
      return { tripped: false, fallbackUntil: config.fallbackUntil };
    }

    // Record failure in database
    await this.prisma.depositCircuitBreakerFailure.create({
      data: {
        provider: PaymentProvider.TELEBIRR,
        transactionRef: params.transactionRef
          ? params.transactionRef.toUpperCase().trim()
          : null,
        userId: params.userId ?? null,
        reason: params.reason?.slice(0, 250) ?? 'Receipt lookup failure',
      },
    });

    // Count upstream failures in rolling window
    const windowStart = new Date(
      now.getTime() - config.fallbackWindowMinutes * 60_000,
    );
    const failureCount = await this.prisma.depositCircuitBreakerFailure.count({
      where: {
        provider: PaymentProvider.TELEBIRR,
        createdAt: { gte: windowStart },
      },
    });

    if (failureCount >= config.fallbackThreshold) {
      const fallbackUntil = new Date(
        now.getTime() + config.fallbackDurationMinutes * 60_000,
      );
      await this.prisma.depositApprovalConfig.update({
        where: { provider: PaymentProvider.TELEBIRR },
        data: {
          fallbackUntil,
          fallbackReason: `${failureCount} upstream failures in ${config.fallbackWindowMinutes}m window`,
        },
      });

      this.invalidateCache();
      return { tripped: true, fallbackUntil };
    }

    return { tripped: false };
  }

  async resetFallback(
    provider: PaymentProvider,
    actorId: string,
  ): Promise<AdminDepositApprovalConfigResponse> {
    await this.prisma.depositApprovalConfig.update({
      where: { provider },
      data: {
        fallbackUntil: null,
        fallbackReason: null,
      },
    });

    await this.prisma.depositCircuitBreakerFailure.deleteMany({
      where: { provider },
    });

    this.invalidateCache();
    await this.auditLogService.create(this.prisma, {
      actorId,
      action: 'admin.deposit_config.reset_fallback',
      entity: 'DepositApprovalConfig',
      entityId: provider,
      metadata: { provider },
    });

    return this.getAdminConfig();
  }

  async isProviderEnabled(provider: PaymentProvider): Promise<boolean> {
    const config = await this.getProviderConfig(provider);
    return config.enabled;
  }

  async updateConfig(
    dto: UpdateDepositApprovalConfigDto,
    actorId: string,
  ): Promise<AdminDepositApprovalConfigResponse> {
    if (!dto.providers.length) {
      throw new BadRequestException(
        'At least one provider config is required.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const entry of dto.providers) {
        const approvalMode = fromApiApprovalMode(entry.approvalMode);
        this.assertModeAllowed(entry.provider, approvalMode);

        const data = {
          enabled: entry.enabled,
          approvalMode,
          ...(entry.fallbackThreshold !== undefined
            ? { fallbackThreshold: entry.fallbackThreshold }
            : {}),
          ...(entry.fallbackWindowMinutes !== undefined
            ? { fallbackWindowMinutes: entry.fallbackWindowMinutes }
            : {}),
          ...(entry.fallbackDurationMinutes !== undefined
            ? { fallbackDurationMinutes: entry.fallbackDurationMinutes }
            : {}),
          updatedById: actorId,
        };

        await tx.depositApprovalConfig.upsert({
          where: { provider: entry.provider },
          create: {
            provider: entry.provider,
            ...data,
          },
          update: data,
        });
      }

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.deposit_config.update',
        entity: 'DepositApprovalConfig',
        entityId: 'providers',
        metadata: {
          providers: dto.providers.map((entry) => ({
            provider: entry.provider,
            enabled: entry.enabled,
            approvalMode: entry.approvalMode,
            fallbackThreshold: entry.fallbackThreshold,
            fallbackWindowMinutes: entry.fallbackWindowMinutes,
            fallbackDurationMinutes: entry.fallbackDurationMinutes,
          })),
        },
      });
    });

    this.invalidateCache();
    return this.getAdminConfig();
  }

  private async getProviderConfig(
    provider: PaymentProvider,
  ): Promise<DepositApprovalConfigRecord> {
    const configs = await this.getAllConfigs();
    const config = configs.find((entry) => entry.provider === provider);
    if (!config) {
      return {
        provider,
        enabled: true,
        approvalMode: DepositApprovalMode.AUTOMATIC,
        fallbackThreshold: 2,
        fallbackWindowMinutes: 3,
        fallbackDurationMinutes: 30,
        fallbackUntil: null,
        fallbackReason: null,
        updatedAt: new Date(),
        updatedById: null,
      };
    }

    return config;
  }

  private async getAllConfigs(): Promise<DepositApprovalConfigRecord[]> {
    const now = Date.now();
    if (this.cachedConfigs && now < this.cacheExpiresAt) {
      return this.cachedConfigs;
    }

    const rows = await this.prisma.depositApprovalConfig.findMany({
      select: depositApprovalConfigSelect,
      orderBy: { provider: 'asc' },
    });

    const byProvider = new Map(rows.map((row) => [row.provider, row]));
    const configs = ALL_DEPOSIT_PROVIDERS.map((provider) => {
      const row = byProvider.get(provider);
      if (!row) {
        return {
          provider,
          enabled: true,
          approvalMode: DepositApprovalMode.AUTOMATIC,
          fallbackThreshold: 2,
          fallbackWindowMinutes: 3,
          fallbackDurationMinutes: 30,
          fallbackUntil: null,
          fallbackReason: null,
          updatedAt: new Date(0),
          updatedById: null,
        };
      }

      return row;
    });

    this.cachedConfigs = configs;
    this.cacheExpiresAt = now + CACHE_TTL_MS;
    return configs;
  }

  private getAllowedModes(provider: PaymentProvider): DepositApprovalMode[] {
    return provider === PaymentProvider.TELEBIRR
      ? TELEBIRR_APPROVAL_MODES
      : STANDARD_APPROVAL_MODES;
  }

  private assertModeAllowed(
    provider: PaymentProvider,
    approvalMode: DepositApprovalMode,
  ): void {
    const allowed = this.getAllowedModes(provider);
    if (!allowed.includes(approvalMode)) {
      throw new BadRequestException(
        `${approvalMode} is not allowed for ${provider}.`,
      );
    }
  }

  private invalidateCache(): void {
    this.cachedConfigs = null;
    this.cacheExpiresAt = 0;
  }
}
