import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WithdrawStatus, WalletTransactionType } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AuditLogService } from '../common/services/audit-log.service';
import {
  buildPaginationMeta,
  getPaginationParams,
} from '../common/utils/pagination.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WalletService } from '../wallet/wallet.service';
import { ApproveWithdrawalDto } from './dto/approve-withdrawal.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { MarkPaidWithdrawalDto } from './dto/mark-paid-withdrawal.dto';
import { RejectWithdrawalDto } from './dto/reject-withdrawal.dto';
import { supportedWithdrawalProviders } from './dto/create-withdrawal.dto';
import {
  adminWithdrawalSelect,
  reversibleWithdrawalStatuses,
  withdrawalSelect,
} from './withdrawals.select';
import {
  serializeAdminWithdrawal,
  serializeWithdrawal,
} from './withdrawals.mapper';

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createWithdrawal(
    userId: string,
    createWithdrawalDto: CreateWithdrawalDto,
  ) {
    if (
      !supportedWithdrawalProviders.includes(
        createWithdrawalDto.provider as (typeof supportedWithdrawalProviders)[number],
      )
    ) {
      throw new BadRequestException('Unsupported withdrawal provider');
    }

    if (
      !createWithdrawalDto.receiverPhone?.trim() &&
      !createWithdrawalDto.receiverAccount?.trim()
    ) {
      throw new BadRequestException(
        'receiverPhone or receiverAccount is required',
      );
    }

    const amount = this.parseAmount(createWithdrawalDto.amount);

    const withdrawal = await this.prisma.$transaction(async (tx) => {
      await this.walletService.getWalletOrThrow(tx, userId);

      const createdWithdrawal = await tx.withdrawal.create({
        data: {
          userId,
          provider: createWithdrawalDto.provider,
          amount,
          receiverPhone: createWithdrawalDto.receiverPhone?.trim() || null,
          receiverAccount: createWithdrawalDto.receiverAccount?.trim() || null,
          status: WithdrawStatus.PENDING,
        },
        select: withdrawalSelect,
      });

      await this.walletService.moveBalanceToLocked(tx, userId, amount, {
        type: WalletTransactionType.WITHDRAW_REQUEST,
        referenceType: 'withdrawal',
        referenceId: createdWithdrawal.id,
        description: `Withdrawal request via ${createdWithdrawal.provider}`,
      });

      return createdWithdrawal;
    });

    const payload = serializeWithdrawal(withdrawal);
    this.emitWithdrawalUpdated(withdrawal.userId, payload);
    await this.emitWalletUpdated(withdrawal.userId);

    return payload;
  }

  async getMyWithdrawals(userId: string, paginationQuery: PaginationQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(paginationQuery);
    const where = { userId };
    const [totalItems, withdrawals] = await Promise.all([
      this.prisma.withdrawal.count({ where }),
      this.prisma.withdrawal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: withdrawalSelect,
      }),
    ]);

    return {
      items: withdrawals.map(serializeWithdrawal),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  async getAllWithdrawals(paginationQuery: PaginationQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(paginationQuery);
    const [totalItems, withdrawals] = await Promise.all([
      this.prisma.withdrawal.count(),
      this.prisma.withdrawal.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: adminWithdrawalSelect,
      }),
    ]);

    return {
      items: withdrawals.map(serializeAdminWithdrawal),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  async approveWithdrawal(
    withdrawalId: string,
    approveWithdrawalDto: ApproveWithdrawalDto,
    actorId?: string,
  ) {
    const payoutTransactionUrl =
      approveWithdrawalDto.payoutTransactionUrl.trim();
    const paidAt = new Date();

    const updatedWithdrawal = await this.prisma.$transaction(async (tx) => {
      const existingWithdrawal = await tx.withdrawal.findUnique({
        where: { id: withdrawalId },
        select: adminWithdrawalSelect,
      });

      if (!existingWithdrawal) {
        throw new NotFoundException('Withdrawal not found');
      }

      if (existingWithdrawal.status !== WithdrawStatus.PENDING) {
        throw new BadRequestException('Withdrawal cannot be approved');
      }

      const updateResult = await tx.withdrawal.updateMany({
        where: {
          id: withdrawalId,
          status: WithdrawStatus.PENDING,
        },
        data: {
          status: WithdrawStatus.PAID,
          paidAt,
          payoutTransactionUrl,
        },
      });

      if (updateResult.count !== 1) {
        throw new BadRequestException('Withdrawal cannot be approved');
      }

      await this.walletService.consumeLockedFunds(
        tx,
        existingWithdrawal.userId,
        existingWithdrawal.amount,
        {
          type: WalletTransactionType.WITHDRAW_PAID,
          referenceType: 'withdrawal',
          referenceId: existingWithdrawal.id,
          description: `Paid withdrawal via ${existingWithdrawal.provider}`,
        },
      );

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.withdrawal.approve',
        entity: 'Withdrawal',
        entityId: withdrawalId,
        metadata: {
          payoutTransactionUrl,
        },
      });

      const refreshedWithdrawal = await tx.withdrawal.findUnique({
        where: { id: withdrawalId },
        select: adminWithdrawalSelect,
      });

      if (!refreshedWithdrawal) {
        throw new NotFoundException('Withdrawal not found after approval');
      }

      return refreshedWithdrawal;
    });

    const payload = serializeAdminWithdrawal(updatedWithdrawal);
    this.emitWithdrawalUpdated(updatedWithdrawal.userId, payload);
    await this.emitWalletUpdated(updatedWithdrawal.userId);
    await this.emitWithdrawalApprovedPush(
      updatedWithdrawal.userId,
      updatedWithdrawal.id,
      updatedWithdrawal.amount,
    );

    return payload;
  }

  async rejectWithdrawal(
    withdrawalId: string,
    rejectWithdrawalDto: RejectWithdrawalDto,
    actorId?: string,
  ) {
    const withdrawal = await this.prisma.$transaction(async (tx) => {
      const existingWithdrawal = await tx.withdrawal.findUnique({
        where: { id: withdrawalId },
        select: adminWithdrawalSelect,
      });

      if (!existingWithdrawal) {
        throw new NotFoundException('Withdrawal not found');
      }

      if (!reversibleWithdrawalStatuses.includes(existingWithdrawal.status)) {
        throw new BadRequestException('Withdrawal cannot be rejected');
      }

      const updateResult = await tx.withdrawal.updateMany({
        where: {
          id: withdrawalId,
          status: { in: reversibleWithdrawalStatuses },
        },
        data: {
          status: WithdrawStatus.REJECTED,
          adminNote: rejectWithdrawalDto.adminNote?.trim() || null,
        },
      });

      if (updateResult.count !== 1) {
        throw new BadRequestException('Withdrawal cannot be rejected');
      }

      await this.walletService.releaseLockedFunds(
        tx,
        existingWithdrawal.userId,
        existingWithdrawal.amount,
        {
          type: WalletTransactionType.WITHDRAW_REFUND,
          referenceType: 'withdrawal',
          referenceId: existingWithdrawal.id,
          description: `Rejected withdrawal via ${existingWithdrawal.provider}`,
        },
      );

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.withdrawal.reject',
        entity: 'Withdrawal',
        entityId: existingWithdrawal.id,
        metadata: {
          adminNote: rejectWithdrawalDto.adminNote?.trim() || null,
        },
      });

      const updatedWithdrawal = await tx.withdrawal.findUnique({
        where: { id: withdrawalId },
        select: adminWithdrawalSelect,
      });

      if (!updatedWithdrawal) {
        throw new NotFoundException('Withdrawal not found after rejection');
      }

      return updatedWithdrawal;
    });

    const payload = serializeAdminWithdrawal(withdrawal);
    this.emitWithdrawalUpdated(withdrawal.userId, payload);
    await this.emitWalletUpdated(withdrawal.userId);
    await this.emitWithdrawalRejectedPush(
      withdrawal.userId,
      withdrawal.id,
      withdrawal.amount,
      rejectWithdrawalDto.adminNote?.trim() || null,
    );

    return payload;
  }

  /** @deprecated Use approveWithdrawal for pending withdrawals. Legacy APPROVED rows only. */
  async markWithdrawalPaid(
    withdrawalId: string,
    markPaidWithdrawalDto: MarkPaidWithdrawalDto,
    actorId?: string,
  ) {
    const paidAt = new Date();

    const withdrawal = await this.prisma.$transaction(async (tx) => {
      const existingWithdrawal = await tx.withdrawal.findUnique({
        where: { id: withdrawalId },
        select: adminWithdrawalSelect,
      });

      if (!existingWithdrawal) {
        throw new NotFoundException('Withdrawal not found');
      }

      if (existingWithdrawal.status !== WithdrawStatus.APPROVED) {
        throw new BadRequestException(
          'Only approved withdrawals can be marked paid',
        );
      }

      const updateResult = await tx.withdrawal.updateMany({
        where: {
          id: withdrawalId,
          status: WithdrawStatus.APPROVED,
        },
        data: {
          status: WithdrawStatus.PAID,
          paidAt,
          payoutRef: markPaidWithdrawalDto.payoutRef?.trim() || null,
        },
      });

      if (updateResult.count !== 1) {
        throw new BadRequestException(
          'Only approved withdrawals can be marked paid',
        );
      }

      await this.walletService.consumeLockedFunds(
        tx,
        existingWithdrawal.userId,
        existingWithdrawal.amount,
        {
          type: WalletTransactionType.WITHDRAW_PAID,
          referenceType: 'withdrawal',
          referenceId: existingWithdrawal.id,
          description: `Paid withdrawal via ${existingWithdrawal.provider}`,
        },
      );

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.withdrawal.mark_paid',
        entity: 'Withdrawal',
        entityId: existingWithdrawal.id,
        metadata: {
          payoutRef: markPaidWithdrawalDto.payoutRef?.trim() || null,
        },
      });

      const updatedWithdrawal = await tx.withdrawal.findUnique({
        where: { id: withdrawalId },
        select: adminWithdrawalSelect,
      });

      if (!updatedWithdrawal) {
        throw new NotFoundException('Withdrawal not found after payment');
      }

      return updatedWithdrawal;
    });

    const payload = serializeAdminWithdrawal(withdrawal);
    this.emitWithdrawalUpdated(withdrawal.userId, payload);
    await this.emitWalletUpdated(withdrawal.userId);

    return payload;
  }

  private parseAmount(amount: string): Prisma.Decimal {
    const decimalAmount = new Prisma.Decimal(amount);

    if (decimalAmount.lte(0)) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    return decimalAmount;
  }

  private emitWithdrawalUpdated(
    userId: string,
    withdrawal: {
      id: string;
      provider: string;
      amount: string;
      status: string;
      updatedAt: Date;
      createdAt: Date;
      paidAt: Date | null;
      payoutRef?: string | null;
      receiverPhone?: string | null;
      receiverAccount?: string | null;
      adminNote?: string | null;
    },
  ): void {
    const playerPayload = {
      id: withdrawal.id,
      provider: withdrawal.provider,
      amount: withdrawal.amount,
      status: withdrawal.status,
      createdAt: withdrawal.createdAt,
      updatedAt: withdrawal.updatedAt,
      paidAt: withdrawal.paidAt,
      adminNote: withdrawal.adminNote ?? null,
    };

    this.realtimeService.emitToUser(
      userId,
      'withdrawal:updated',
      playerPayload,
    );
    this.realtimeService.emitToAdmin('withdrawal:updated', {
      ...playerPayload,
      userId,
    });
  }

  private async emitWalletUpdated(userId: string): Promise<void> {
    const wallet = await this.walletService.getSerializedWallet(userId);
    this.realtimeService.emitToUser(userId, 'wallet:updated', wallet);
    this.realtimeService.emitToAdmin('wallet:updated', wallet);
  }

  private async emitWithdrawalApprovedPush(
    userId: string,
    withdrawalId: string,
    amount: Prisma.Decimal,
  ) {
    try {
      await this.notificationsService.sendAppNotificationToUser(userId, {
        category: 'WITHDRAWAL_APPROVED',
        title: 'Withdrawal approved',
        body: `Your withdrawal of ${amount.toString()} ETB has been approved and paid out.`,
        route: '/wallet/withdrawals',
        entityId: withdrawalId,
        data: {
          withdrawalId,
          amount: amount.toString(),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send WITHDRAWAL_APPROVED push for withdrawal ${withdrawalId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async emitWithdrawalRejectedPush(
    userId: string,
    withdrawalId: string,
    amount: Prisma.Decimal,
    adminNote: string | null,
  ) {
    try {
      const noteSuffix = adminNote ? ` ${adminNote}` : '';
      await this.notificationsService.sendAppNotificationToUser(userId, {
        category: 'WITHDRAWAL_REJECTED',
        title: 'Withdrawal rejected',
        body: `Your withdrawal of ${amount.toString()} ETB was rejected.${noteSuffix}`,
        route: '/wallet/withdrawals',
        entityId: withdrawalId,
        data: {
          withdrawalId,
          amount: amount.toString(),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send WITHDRAWAL_REJECTED push for withdrawal ${withdrawalId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
