import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DepositStatus,
  PaymentProvider,
  Prisma,
  WalletTransactionType,
} from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AuditLogService } from '../common/services/audit-log.service';
import {
  buildPaginationMeta,
  getPaginationParams,
} from '../common/utils/pagination.util';
import {
  DepositVerificationResult,
} from '../payment-verification/types/deposit-verification-result.type';
import { PaymentVerificationService } from '../payment-verification/payment-verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WalletService } from '../wallet/wallet.service';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { RejectDepositDto } from './dto/reject-deposit.dto';
import {
  serializeAdminDeposit,
  serializeDeposit,
} from './deposits.mapper';
import {
  adminDepositSelect,
  depositSelect,
  retryableDepositStatuses,
  updatableDepositStatuses,
} from './deposits.select';

const DEPOSIT_RETRY_COOLDOWN_MS = 30_000;

@Injectable()
export class DepositsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly paymentVerificationService: PaymentVerificationService,
    private readonly configService: ConfigService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async createDeposit(userId: string, createDepositDto: CreateDepositDto) {
    const amount = this.parseAmount(createDepositDto.amount);
    const transactionRef = this.normalizeTransactionRef(
      createDepositDto.transactionRef,
    );

    try {
      const deposit = await this.prisma.deposit.create({
        data: {
          userId,
          provider: createDepositDto.provider,
          amount,
          transactionRef,
          status: DepositStatus.VERIFYING,
        },
        select: adminDepositSelect,
      });

      const processedDeposit = await this.runAutomaticVerification(deposit.id);
      this.emitDepositUpdated(processedDeposit);
      if (processedDeposit.status === DepositStatus.APPROVED) {
        await this.emitWalletUpdated(processedDeposit.userId);
      }
      return serializeDeposit(processedDeposit);
    } catch (error) {
      this.handleUniqueConstraint(error, 'transaction reference already exists');
      throw error;
    }
  }

  async retryVerification(userId: string, depositId: string) {
    const deposit = await this.prisma.deposit.findFirst({
      where: {
        id: depositId,
        userId,
      },
      select: adminDepositSelect,
    });

    if (!deposit) {
      throw new NotFoundException('Deposit not found');
    }

    if (!retryableDepositStatuses.includes(deposit.status)) {
      throw new BadRequestException('Deposit cannot be retried');
    }

    if (
      Date.now() - deposit.updatedAt.getTime() < DEPOSIT_RETRY_COOLDOWN_MS
    ) {
      throw new HttpException(
        'Please wait before retrying verification',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.prisma.deposit.update({
      where: { id: depositId },
      data: {
        status: DepositStatus.VERIFYING,
        rejectionReason: null,
      },
    });

    const processedDeposit = await this.runAutomaticVerification(depositId);
    this.emitDepositUpdated(processedDeposit);
    if (processedDeposit.status === DepositStatus.APPROVED) {
      await this.emitWalletUpdated(processedDeposit.userId);
    }
    return serializeDeposit(processedDeposit);
  }

  async getMyDeposits(userId: string, paginationQuery: PaginationQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(paginationQuery);
    const where = { userId };
    const [totalItems, deposits] = await Promise.all([
      this.prisma.deposit.count({ where }),
      this.prisma.deposit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: depositSelect,
      }),
    ]);

    return {
      items: deposits.map(serializeDeposit),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  async getAllDeposits(paginationQuery: PaginationQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(paginationQuery);
    const [totalItems, deposits] = await Promise.all([
      this.prisma.deposit.count(),
      this.prisma.deposit.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: adminDepositSelect,
      }),
    ]);

    return {
      items: deposits.map(serializeAdminDeposit),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  async approveDeposit(depositId: string, actorId?: string) {
    const deposit = await this.approveDepositRecord(
      depositId,
      undefined,
      'Manual admin approval',
      actorId,
    );

    this.emitDepositUpdated(deposit);
    await this.emitWalletUpdated(deposit.userId);

    return serializeAdminDeposit(deposit);
  }

  async rejectDeposit(
    depositId: string,
    rejectDepositDto: RejectDepositDto,
    actorId?: string,
  ) {
    const deposit = await this.prisma.$transaction(async (tx) => {
      const existingDeposit = await tx.deposit.findUnique({
        where: { id: depositId },
        select: adminDepositSelect,
      });

      if (!existingDeposit) {
        throw new NotFoundException('Deposit not found');
      }

      if (!updatableDepositStatuses.includes(existingDeposit.status)) {
        throw new BadRequestException('Deposit cannot be rejected');
      }

      const updateResult = await tx.deposit.updateMany({
        where: {
          id: depositId,
          status: { in: updatableDepositStatuses },
        },
        data: {
          status: DepositStatus.REJECTED,
          rejectionReason: rejectDepositDto.rejectionReason.trim(),
        },
      });

      if (updateResult.count !== 1) {
        throw new BadRequestException('Deposit cannot be rejected');
      }

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.deposit.reject',
        entity: 'Deposit',
        entityId: depositId,
        metadata: {
          rejectionReason: rejectDepositDto.rejectionReason.trim(),
        },
      });

      const updatedDeposit = await tx.deposit.findUnique({
        where: { id: depositId },
        select: adminDepositSelect,
      });

      if (!updatedDeposit) {
        throw new NotFoundException('Deposit not found after rejection');
      }

      return updatedDeposit;
    });

    this.emitDepositUpdated(deposit);

    return serializeAdminDeposit(deposit);
  }

  private async runAutomaticVerification(depositId: string) {
    const deposit = await this.prisma.deposit.findUnique({
      where: { id: depositId },
      select: adminDepositSelect,
    });

    if (!deposit) {
      throw new NotFoundException('Deposit not found');
    }

    let verificationResult: DepositVerificationResult;

    try {
      verificationResult = await this.paymentVerificationService.verifyDeposit({
        depositId: deposit.id,
        provider: deposit.provider,
        transactionRef: deposit.transactionRef,
        requestedAmount: deposit.amount.toString(),
      });
    } catch (_error) {
      return this.moveDepositToManualReview(
        deposit.id,
        'Automatic verification is temporarily unavailable',
        this.buildFallbackVerificationResult(deposit),
      );
    }

    return this.processVerificationResult(deposit, verificationResult);
  }

  private async processVerificationResult(
    deposit: Prisma.DepositGetPayload<{ select: typeof adminDepositSelect }>,
    verificationResult: DepositVerificationResult,
  ) {
    switch (verificationResult.status) {
      case 'VERIFIED': {
        const decision = await this.validateVerifiedDeposit(
          deposit,
          verificationResult,
        );

        if (decision.action === 'APPROVE') {
          const approvedDeposit = await this.approveDepositRecord(
            deposit.id,
            verificationResult,
            'Automatic provider verification',
          );

          return approvedDeposit;
        }

        if (decision.action === 'REJECT') {
          return this.rejectDepositAutomatically(
            deposit.id,
            decision.reason,
            verificationResult,
          );
        }

        return this.moveDepositToManualReview(
          deposit.id,
          decision.reason,
          verificationResult,
        );
      }

      case 'INVALID':
        return this.rejectDepositAutomatically(
          deposit.id,
          verificationResult.reason ?? 'Provider could not validate the payment',
          verificationResult,
        );

      case 'PENDING':
      case 'ERROR':
      case 'MANUAL_REVIEW':
      default:
        return this.moveDepositToManualReview(
          deposit.id,
          verificationResult.reason ?? 'Deposit requires manual review',
          verificationResult,
        );
    }
  }

  private async validateVerifiedDeposit(
    deposit: Prisma.DepositGetPayload<{ select: typeof adminDepositSelect }>,
    verificationResult: DepositVerificationResult,
  ): Promise<
    | { action: 'APPROVE' }
    | { action: 'REJECT'; reason: string }
    | { action: 'MANUAL_REVIEW'; reason: string }
  > {
    const normalizedProviderRef = this.normalizeTransactionRef(
      verificationResult.transactionRef,
    );

    if (normalizedProviderRef !== deposit.transactionRef) {
      return {
        action: 'MANUAL_REVIEW',
        reason: 'Provider transaction reference could not be confirmed',
      };
    }

    if (verificationResult.currency) {
      const normalizedCurrency = verificationResult.currency
        .trim()
        .toUpperCase();

      if (normalizedCurrency !== 'ETB') {
        return {
          action: 'REJECT',
          reason: 'Deposit currency is not supported',
        };
      }
    }

    if (!verificationResult.amount) {
      return {
        action: 'MANUAL_REVIEW',
        reason: 'Provider amount could not be confirmed',
      };
    }

    const providerAmount = new Prisma.Decimal(verificationResult.amount);
    if (!providerAmount.equals(deposit.amount)) {
      return {
        action: 'MANUAL_REVIEW',
        reason: 'Verified amount does not match the requested deposit amount',
      };
    }

    const receiverValidation = this.validateReceiverMatch(
      deposit.provider,
      verificationResult,
    );
    if (receiverValidation.action !== 'APPROVE') {
      return receiverValidation;
    }

    const duplicateApprovedDeposit = await this.prisma.deposit.findFirst({
      where: {
        transactionRef: deposit.transactionRef,
        status: DepositStatus.APPROVED,
        id: {
          not: deposit.id,
        },
      },
      select: { id: true },
    });

    if (duplicateApprovedDeposit) {
      return {
        action: 'REJECT',
        reason: 'Transaction reference has already been used',
      };
    }

    return { action: 'APPROVE' };
  }

  private validateReceiverMatch(
    provider: PaymentProvider,
    verificationResult: DepositVerificationResult,
  ):
    | { action: 'APPROVE' }
    | { action: 'MANUAL_REVIEW'; reason: string } {
    if (provider === PaymentProvider.CBE) {
      const configuredAccount =
        this.configService.get<string>('CBE_ACCOUNT_NUMBER') ?? '';
      const configuredLast8 =
        this.configService.get<string>('CBE_ACCOUNT_LAST8') ?? '';
      const configuredReceiverName =
        this.configService.get<string>('CBE_RECEIVER_NAME') ?? '';

      if (!verificationResult.receiverAccount) {
        return {
          action: 'MANUAL_REVIEW',
          reason: 'Receiver account could not be confirmed automatically',
        };
      }

      const normalizedReceiverAccount = this.normalizeDigits(
        verificationResult.receiverAccount,
      );
      const normalizedConfiguredAccount = this.normalizeDigits(configuredAccount);
      const normalizedConfiguredLast8 = this.normalizeDigits(configuredLast8);

      if (!normalizedConfiguredAccount && !normalizedConfiguredLast8) {
        return {
          action: 'MANUAL_REVIEW',
          reason: 'Merchant receiver account is not configured for verification',
        };
      }

      const accountMatches =
        (normalizedConfiguredAccount &&
          normalizedReceiverAccount === normalizedConfiguredAccount) ||
        (normalizedConfiguredLast8 &&
          normalizedReceiverAccount.slice(-8) === normalizedConfiguredLast8);

      if (!accountMatches) {
        return {
          action: 'MANUAL_REVIEW',
          reason: 'Receiver account does not match the configured merchant account',
        };
      }

      if (configuredReceiverName) {
        if (!verificationResult.receiverName) {
          return {
            action: 'MANUAL_REVIEW',
            reason: 'Receiver name could not be confirmed automatically',
          };
        }

        if (
          this.normalizeName(verificationResult.receiverName) !==
          this.normalizeName(configuredReceiverName)
        ) {
          return {
            action: 'MANUAL_REVIEW',
            reason: 'Receiver name does not match the configured merchant name',
          };
        }
      }

      return { action: 'APPROVE' };
    }

    if (provider === PaymentProvider.TELEBIRR) {
      const configuredPhone =
        this.configService.get<string>('TELEBIRR_RECEIVER_PHONE') ?? '';
      const configuredReceiverName =
        this.configService.get<string>('TELEBIRR_RECEIVER_NAME') ?? '';

      if (!verificationResult.receiverAccount) {
        return {
          action: 'MANUAL_REVIEW',
          reason: 'Receiver phone could not be confirmed automatically',
        };
      }

      const normalizedReceiverPhone = this.normalizeDigits(
        verificationResult.receiverAccount,
      );
      const normalizedConfiguredPhone = this.normalizeDigits(configuredPhone);

      if (!normalizedConfiguredPhone) {
        return {
          action: 'MANUAL_REVIEW',
          reason: 'Merchant receiver phone is not configured for verification',
        };
      }

      if (normalizedReceiverPhone !== normalizedConfiguredPhone) {
        return {
          action: 'MANUAL_REVIEW',
          reason: 'Receiver phone does not match the configured merchant phone',
        };
      }

      if (configuredReceiverName) {
        if (!verificationResult.receiverName) {
          return {
            action: 'MANUAL_REVIEW',
            reason: 'Receiver name could not be confirmed automatically',
          };
        }

        if (
          this.normalizeName(verificationResult.receiverName) !==
          this.normalizeName(configuredReceiverName)
        ) {
          return {
            action: 'MANUAL_REVIEW',
            reason: 'Receiver name does not match the configured merchant name',
          };
        }
      }

      return { action: 'APPROVE' };
    }

    return {
      action: 'MANUAL_REVIEW',
      reason: 'Unsupported payment provider for automatic verification',
    };
  }

  private async approveDepositRecord(
    depositId: string,
    verificationResult?: DepositVerificationResult,
    verificationSource?: string,
    actorId?: string,
  ) {
    const approvedAt = new Date();

    const deposit = await this.prisma.$transaction(async (tx) => {
      const existingDeposit = await tx.deposit.findUnique({
        where: { id: depositId },
        select: adminDepositSelect,
      });

      if (!existingDeposit) {
        throw new NotFoundException('Deposit not found');
      }

      if (!updatableDepositStatuses.includes(existingDeposit.status)) {
        throw new BadRequestException('Deposit cannot be approved');
      }

      const duplicateApprovedDeposit = await tx.deposit.findFirst({
        where: {
          transactionRef: existingDeposit.transactionRef,
          status: DepositStatus.APPROVED,
          id: {
            not: existingDeposit.id,
          },
        },
        select: { id: true },
      });

      if (duplicateApprovedDeposit) {
        throw new ConflictException('Transaction reference has already been used');
      }

      const updateResult = await tx.deposit.updateMany({
        where: {
          id: depositId,
          status: { in: updatableDepositStatuses },
        },
        data: {
          status: DepositStatus.APPROVED,
          verifiedAt: approvedAt,
          rejectionReason: null,
          ...(verificationResult
            ? {
                verifiedData: this.serializeVerificationData(
                  verificationResult,
                  verificationSource ?? 'Automatic verification',
                  'APPROVED',
                ),
              }
            : {}),
        },
      });

      if (updateResult.count !== 1) {
        throw new BadRequestException('Deposit cannot be approved');
      }

      await this.walletService.creditWallet(
        tx,
        existingDeposit.userId,
        existingDeposit.amount,
        {
          type: WalletTransactionType.DEPOSIT,
          referenceType: 'deposit',
          referenceId: existingDeposit.id,
          description: `Approved ${existingDeposit.provider} deposit`,
        },
      );

      if (actorId) {
        await this.auditLogService.create(tx, {
          actorId,
          action: 'admin.deposit.approve',
          entity: 'Deposit',
          entityId: existingDeposit.id,
          metadata: {
            provider: existingDeposit.provider,
            amount: existingDeposit.amount.toString(),
            verificationSource: verificationSource ?? 'Manual approval',
          },
        });
      }

      const updatedDeposit = await tx.deposit.findUnique({
        where: { id: depositId },
        select: adminDepositSelect,
      });

      if (!updatedDeposit) {
        throw new NotFoundException('Deposit not found after approval');
      }

      return updatedDeposit;
    });

    return deposit;
  }

  private async rejectDepositAutomatically(
    depositId: string,
    reason: string,
    verificationResult: DepositVerificationResult,
  ) {
    const updatedDeposit = await this.prisma.deposit.update({
      where: { id: depositId },
      data: {
        status: DepositStatus.REJECTED,
        rejectionReason: reason,
        verifiedData: this.serializeVerificationData(
          verificationResult,
          'Automatic verification',
          'REJECTED',
        ),
      },
      select: adminDepositSelect,
    });

    return updatedDeposit;
  }

  private async moveDepositToManualReview(
    depositId: string,
    reason: string,
    verificationResult: DepositVerificationResult,
  ) {
    const updatedDeposit = await this.prisma.deposit.update({
      where: { id: depositId },
      data: {
        status: DepositStatus.MANUAL_REVIEW,
        rejectionReason: reason,
        verifiedData: this.serializeVerificationData(
          verificationResult,
          'Automatic verification',
          'MANUAL_REVIEW',
        ),
      },
      select: adminDepositSelect,
    });

    return updatedDeposit;
  }

  private emitDepositUpdated(
    deposit: Prisma.DepositGetPayload<{ select: typeof adminDepositSelect }>,
  ): void {
    const payload = {
      id: deposit.id,
      provider: deposit.provider,
      amount: deposit.amount.toString(),
      transactionRef: deposit.transactionRef,
      status: deposit.status,
      rejectionReason: deposit.rejectionReason,
      verifiedAt: deposit.verifiedAt,
      updatedAt: deposit.updatedAt,
    };

    this.realtimeService.emitToUser(deposit.userId, 'deposit:updated', payload);
    this.realtimeService.emitToAdmin('deposit:updated', {
      ...payload,
      userId: deposit.userId,
    });
  }

  private async emitWalletUpdated(userId: string): Promise<void> {
    const wallet = await this.walletService.getSerializedWallet(userId);
    this.realtimeService.emitToUser(userId, 'wallet:updated', wallet);
    this.realtimeService.emitToAdmin('wallet:updated', wallet);
  }

  private parseAmount(amount: string): Prisma.Decimal {
    const decimalAmount = new Prisma.Decimal(amount);

    if (decimalAmount.lte(0)) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    return decimalAmount;
  }

  private normalizeTransactionRef(transactionRef: string): string {
    return transactionRef.trim().toUpperCase();
  }

  private normalizeDigits(value: string): string {
    return value.replace(/\D/g, '');
  }

  private normalizeName(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private buildFallbackVerificationResult(
    deposit: Prisma.DepositGetPayload<{ select: typeof adminDepositSelect }>,
  ): DepositVerificationResult {
    return {
      verified: false,
      status: 'ERROR',
      provider: deposit.provider,
      transactionRef: deposit.transactionRef,
      reason: 'Provider verification failed unexpectedly',
    };
  }

  private serializeVerificationData(
    verificationResult: DepositVerificationResult,
    verificationSource: string,
    decision: 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW',
  ): Prisma.InputJsonValue {
    return JSON.parse(
      JSON.stringify({
        verificationSource,
        decision,
        verified: verificationResult.verified,
        status: verificationResult.status,
        provider: verificationResult.provider,
        transactionRef: verificationResult.transactionRef,
        amount: verificationResult.amount,
        currency: verificationResult.currency,
        payerName: verificationResult.payerName,
        payerAccount: verificationResult.payerAccount,
        receiverName: verificationResult.receiverName,
        receiverAccount: verificationResult.receiverAccount,
        paidAt: verificationResult.paidAt,
        raw: verificationResult.raw,
        reason: verificationResult.reason,
      }),
    ) as Prisma.InputJsonValue;
  }

  private handleUniqueConstraint(error: unknown, message: string): void {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(message);
    }
  }
}
