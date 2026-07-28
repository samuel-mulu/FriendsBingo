import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import {
  DepositApprovalMode,
  PaymentProvider,
  Prisma,
} from '@prisma/client';
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
    return {
      providers: configs.map((config) => ({
        provider: config.provider,
        enabled: config.enabled,
        approvalMode: toApiApprovalMode(config.approvalMode),
        allowedModes: this.getAllowedModes(config.provider).map(toApiApprovalMode),
        updatedAt: config.updatedAt.toISOString(),
        updatedById: config.updatedById,
      })),
    };
  }

  async getPlayerProviderConfigs(): Promise<
    PlayerDepositProviderApprovalConfig[]
  > {
    const configs = await this.getAllConfigs();
    return configs.map((config) => ({
      key: config.provider,
      enabled: config.enabled,
      approvalMode: toApiApprovalMode(config.approvalMode),
    }));
  }

  async getMode(provider: PaymentProvider): Promise<DepositApprovalMode> {
    const config = await this.getProviderConfig(provider);
    if (!config.enabled) {
      throw new BadRequestException(
        `${provider} deposits are currently unavailable.`,
      );
    }

    return config.approvalMode;
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
      throw new BadRequestException('At least one provider config is required.');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const entry of dto.providers) {
        const approvalMode = fromApiApprovalMode(entry.approvalMode);
        this.assertModeAllowed(entry.provider, approvalMode);

        await tx.depositApprovalConfig.upsert({
          where: { provider: entry.provider },
          create: {
            provider: entry.provider,
            enabled: entry.enabled,
            approvalMode,
            updatedById: actorId,
          },
          update: {
            enabled: entry.enabled,
            approvalMode,
            updatedById: actorId,
          },
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
