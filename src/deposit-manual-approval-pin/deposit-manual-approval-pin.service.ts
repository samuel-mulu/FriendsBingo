import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuditLogService } from '../common/services/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeDepositManualApprovalPinDto } from './dto/change-deposit-manual-approval-pin.dto';
import {
  DEFAULT_DEPOSIT_MANUAL_APPROVAL_PIN_HASH,
  DEPOSIT_MANUAL_APPROVAL_PIN_CONFIG_ID,
} from './deposit-manual-approval-pin.defaults';
import {
  AdminDepositManualApprovalPinConfigResponse,
  DepositManualApprovalPinConfigRecord,
} from './deposit-manual-approval-pin.types';

const CACHE_TTL_MS = 30_000;
const BCRYPT_ROUNDS = 10;

const depositManualApprovalPinConfigSelect = {
  id: true,
  pinHash: true,
  updatedAt: true,
  updatedById: true,
} satisfies Prisma.DepositManualApprovalPinConfigSelect;

@Injectable()
export class DepositManualApprovalPinService {
  private cachedConfig: DepositManualApprovalPinConfigRecord | null = null;
  private cacheExpiresAt = 0;
  private cachedFromDatabase = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getAdminConfig(): Promise<AdminDepositManualApprovalPinConfigResponse> {
    const { config, storedInDatabase } = await this.loadConfig();
    return this.toAdminResponse(config, storedInDatabase);
  }

  async assertValidApprovalPin(approvalPin: string): Promise<void> {
    const { config } = await this.loadConfig();
    const isValid = await bcrypt.compare(approvalPin, config.pinHash);
    if (!isValid) {
      throw new BadRequestException({
        message: 'Invalid approval PIN.',
        code: 'INVALID_APPROVAL_PIN',
      });
    }
  }

  async changePin(
    dto: ChangeDepositManualApprovalPinDto,
    actorId: string,
  ): Promise<AdminDepositManualApprovalPinConfigResponse> {
    if (dto.currentPin === dto.newPin) {
      throw new BadRequestException({
        message: 'New PIN must be different from the current PIN.',
        code: 'DEPOSIT_APPROVAL_PIN_UNCHANGED',
      });
    }

    const { config } = await this.loadConfig();
    const isCurrentValid = await bcrypt.compare(dto.currentPin, config.pinHash);
    if (!isCurrentValid) {
      throw new BadRequestException({
        message: 'Current PIN is incorrect.',
        code: 'INVALID_CURRENT_DEPOSIT_APPROVAL_PIN',
      });
    }

    const pinHash = await bcrypt.hash(dto.newPin, BCRYPT_ROUNDS);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.depositManualApprovalPinConfig.upsert({
        where: { id: DEPOSIT_MANUAL_APPROVAL_PIN_CONFIG_ID },
        create: {
          id: DEPOSIT_MANUAL_APPROVAL_PIN_CONFIG_ID,
          pinHash,
          updatedById: actorId,
        },
        update: {
          pinHash,
          updatedById: actorId,
        },
        select: depositManualApprovalPinConfigSelect,
      });

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.deposit_manual_approval_pin.change',
        entity: 'DepositManualApprovalPinConfig',
        entityId: row.id,
        metadata: {},
      });

      return row;
    });

    this.setCache(updated, true);
    return this.toAdminResponse(updated, true);
  }

  private async loadConfig(): Promise<{
    config: DepositManualApprovalPinConfigRecord;
    storedInDatabase: boolean;
  }> {
    const now = Date.now();
    if (this.cachedConfig && now < this.cacheExpiresAt) {
      return {
        config: this.cachedConfig,
        storedInDatabase: this.cachedFromDatabase,
      };
    }

    try {
      const row = await this.prisma.depositManualApprovalPinConfig.findUnique({
        where: { id: DEPOSIT_MANUAL_APPROVAL_PIN_CONFIG_ID },
        select: depositManualApprovalPinConfigSelect,
      });

      if (row) {
        this.setCache(row, true);
        return { config: row, storedInDatabase: true };
      }

      const fallback = this.getFallbackConfig();
      this.setCache(fallback, false);
      return { config: fallback, storedInDatabase: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2021'
      ) {
        const fallback = this.getFallbackConfig();
        this.setCache(fallback, false);
        return { config: fallback, storedInDatabase: false };
      }

      throw error;
    }
  }

  private setCache(
    config: DepositManualApprovalPinConfigRecord,
    storedInDatabase: boolean,
  ) {
    this.cachedConfig = config;
    this.cachedFromDatabase = storedInDatabase;
    this.cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  }

  private getFallbackConfig(): DepositManualApprovalPinConfigRecord {
    return {
      id: DEPOSIT_MANUAL_APPROVAL_PIN_CONFIG_ID,
      pinHash: DEFAULT_DEPOSIT_MANUAL_APPROVAL_PIN_HASH,
      updatedAt: new Date(0),
      updatedById: null,
    };
  }

  private toAdminResponse(
    config: DepositManualApprovalPinConfigRecord,
    storedInDatabase: boolean,
  ): AdminDepositManualApprovalPinConfigResponse {
    return {
      id: config.id,
      updatedAt: config.updatedAt.toISOString(),
      updatedById: config.updatedById,
      storedInDatabase,
    };
  }
}
