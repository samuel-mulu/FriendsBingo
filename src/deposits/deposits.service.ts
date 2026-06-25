import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
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
import { UserActionRateLimitService } from '../common/rate-limit/user-action-rate-limit.service';
import {
  buildPaginationMeta,
  getPaginationParams,
} from '../common/utils/pagination.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { VerifyEtService } from '../verify-et/verify-et.service';
import { VerifyDepositResult } from '../verify-et/verify-et.types';
import { WalletService } from '../wallet/wallet.service';
import {
  DEPOSIT_APPROVED_MESSAGE,
  DEPOSIT_CHECK_REF_OK_MESSAGE,
  DEPOSIT_ERROR_MESSAGES,
  DepositErrorCode,
} from './deposit-verification.errors';
import { CheckDepositReferenceDto } from './dto/check-deposit-reference.dto';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { RejectDepositDto } from './dto/reject-deposit.dto';
import { serializeAdminDeposit, serializeDeposit } from './deposits.mapper';
import {
  adminDepositSelect,
  depositSelect,
  updatableDepositStatuses,
} from './deposits.select';

type CheckReferenceCode = 'OK' | 'ALREADY_USED';
type TerminalDepositStatus = Extract<DepositStatus, 'APPROVED' | 'REJECTED'>;

@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly verifyEtService: VerifyEtService,
    private readonly configService: ConfigService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
    private readonly notificationsService: NotificationsService = {
      sendAppNotificationToUser: async () => ({
        userId: '',
        sentCount: 0,
        failedCount: 0,
      }),
    } as unknown as NotificationsService,
    private readonly userActionRateLimitService: UserActionRateLimitService = {
      assertWithinLimit: () => undefined,
    } as unknown as UserActionRateLimitService,
  ) {}

  async createDeposit(userId: string, createDepositDto: CreateDepositDto) {
    this.userActionRateLimitService.assertWithinLimit('deposit_request', userId);
    const amount = this.parseAmount(createDepositDto.amount);
    const transactionRef = this.normalizeTransactionRef(
      createDepositDto.transactionRef,
    );
    this.ensureTransactionRefFormat(transactionRef);

    if (createDepositDto.clientReceipt || createDepositDto.receiptParseStatus) {
      this.logger.debug(
        `[deposit] advisory telebirr client receipt ignored userId=${userId} ref=${transactionRef}`,
      );
    }

    await this.ensureReferenceAvailable(
      createDepositDto.provider,
      transactionRef,
    );

    const verification = await this.verifyEtService.verifyDeposit({
      provider: createDepositDto.provider,
      reference: transactionRef,
      amount: amount.toString(),
    });

    const decision = this.evaluateVerification(amount, verification);
    if (decision.status !== DepositStatus.APPROVED) {
      throw this.buildDepositException(
        decision.errorCode ?? 'INVALID_RECEIPT',
        decision.rejectionReason,
      );
    }

    const approvedDeposit = await this.createApprovedDeposit({
      userId,
      provider: createDepositDto.provider,
      amount,
      transactionRef,
      verification,
    });

    this.emitDepositUpdated(approvedDeposit);
    await this.emitWalletUpdated(approvedDeposit.userId);
    await this.emitDepositApprovedPush(
      approvedDeposit.userId,
      approvedDeposit.id,
      approvedDeposit.amount,
    );

    return serializeDeposit(approvedDeposit);
  }

  async checkDepositReference(
    userId: string,
    checkDepositReferenceDto: CheckDepositReferenceDto,
  ) {
    this.userActionRateLimitService.assertWithinLimit(
      'deposit_check_ref',
      userId,
    );
    const transactionRef = this.normalizeTransactionRef(
      checkDepositReferenceDto.transactionRef,
    );
    this.ensureTransactionRefFormat(transactionRef);

    const existing = await this.findDepositByReference(
      checkDepositReferenceDto.provider,
      transactionRef,
    );

    if (existing) {
      return {
        code: 'ALREADY_USED' as const,
        message: DEPOSIT_ERROR_MESSAGES.ALREADY_USED,
      };
    }

    return {
      code: 'OK' as const,
      message: DEPOSIT_CHECK_REF_OK_MESSAGE,
    };
  }

  getDepositConfig() {
    const telebirrProviderName =
      this.configService.get<string>('TELEBIRR_PROVIDER_NAME') ?? 'Telebirr';
    const telebirrReceiverPhone =
      this.configService.get<string>('TELEBIRR_RECEIVER_PHONE') ?? '';
    const telebirrReceiverPhoneLast4 =
      this.configService.get<string>('TELEBIRR_RECEIVER_PHONE_LAST4') ??
      this.normalizeDigits(telebirrReceiverPhone).slice(-4);

    const providerHelpText: Record<PaymentProvider, string> = {
      [PaymentProvider.TELEBIRR]:
        'Enter the receipt code and the Settled Amount, not the Total Paid Amount.',
      [PaymentProvider.CBE]:
        'Send money with CBE, then enter the payment reference number and exact transferred amount.',
      [PaymentProvider.AWASH]:
        'Send money with Awash Bank, then enter the payment reference number and exact transferred amount.',
      [PaymentProvider.BOA]:
        'Send money with Bank of Abyssinia, then enter the payment reference number and exact transferred amount.',
    };

    const providerLabels: Record<PaymentProvider, string> = {
      [PaymentProvider.TELEBIRR]: 'Receipt code',
      [PaymentProvider.CBE]: 'Reference number',
      [PaymentProvider.AWASH]: 'Reference number',
      [PaymentProvider.BOA]: 'Reference number',
    };

    const providerNames: Record<PaymentProvider, string> = {
      [PaymentProvider.TELEBIRR]: telebirrProviderName,
      [PaymentProvider.CBE]:
        this.configService.get<string>('CBE_PROVIDER_NAME') ?? 'CBE Bank',
      [PaymentProvider.AWASH]:
        this.configService.get<string>('AWASH_PROVIDER_NAME') ?? 'Awash Bank',
      [PaymentProvider.BOA]:
        this.configService.get<string>('BOA_PROVIDER_NAME') ??
        'Bank of Abyssinia',
    };

    const settlementAccounts: Record<PaymentProvider, string> = {
      [PaymentProvider.TELEBIRR]:
        this.configService.get<string>('TELEBIRR_SETTLEMENT_ACCOUNT') ??
        telebirrReceiverPhone,
      [PaymentProvider.CBE]:
        this.configService.get<string>('CBE_SETTLEMENT_ACCOUNT') ?? '',
      [PaymentProvider.AWASH]:
        this.configService.get<string>('AWASH_SETTLEMENT_ACCOUNT') ?? '',
      [PaymentProvider.BOA]:
        this.configService.get<string>('BOA_SETTLEMENT_ACCOUNT') ?? '',
    };

    const receiverNames: Record<PaymentProvider, string> = {
      [PaymentProvider.TELEBIRR]:
        this.configService.get<string>('TELEBIRR_RECEIVER_NAME') ?? '',
      [PaymentProvider.CBE]:
        this.configService.get<string>('CBE_RECEIVER_NAME') ?? '',
      [PaymentProvider.AWASH]:
        this.configService.get<string>('AWASH_RECEIVER_NAME') ?? '',
      [PaymentProvider.BOA]:
        this.configService.get<string>('BOA_RECEIVER_NAME') ?? '',
    };

    return {
      providers: [
        PaymentProvider.TELEBIRR,
        PaymentProvider.CBE,
        PaymentProvider.AWASH,
        PaymentProvider.BOA,
      ].map((key) => ({
        key,
        name: providerNames[key],
        receiptCodeLabel: providerLabels[key],
        helpText: providerHelpText[key],
        requiresAmount: true,
        settlementAccount: settlementAccounts[key],
        receiverName: receiverNames[key],
      })),
      telebirr: {
        providerName: telebirrProviderName,
        receiptHelpText: providerHelpText[PaymentProvider.TELEBIRR],
        receiptBaseUrl:
          this.configService.get<string>('TELEBIRR_RECEIPT_BASE_URL') ??
          'https://transactioninfo.ethiotelecom.et/receipt',
        receiverPhoneLast4: telebirrReceiverPhoneLast4,
        receiverName:
          this.configService.get<string>('TELEBIRR_RECEIVER_NAME') ?? '',
      },
    };
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
      'Manual admin approval',
      actorId,
    );

    this.emitDepositUpdated(deposit);
    await this.emitWalletUpdated(deposit.userId);
    await this.emitDepositApprovedPush(
      deposit.userId,
      deposit.id,
      deposit.amount,
    );

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

      if (actorId) {
        await this.auditLogService.create(tx, {
          actorId,
          action: 'admin.deposit.reject',
          entity: 'Deposit',
          entityId: depositId,
          metadata: {
            rejectionReason: rejectDepositDto.rejectionReason.trim(),
            provider: existingDeposit.provider,
            amount: existingDeposit.amount.toString(),
            transactionRef: existingDeposit.transactionRef,
          },
        });
      }

      await tx.deposit.delete({
        where: { id: depositId },
      });

      return existingDeposit;
    });

    this.emitDepositUpdated({
      ...deposit,
      status: DepositStatus.REJECTED,
      rejectionReason: rejectDepositDto.rejectionReason.trim(),
      updatedAt: new Date(),
    });

    return serializeAdminDeposit({
      ...deposit,
      status: DepositStatus.REJECTED,
      rejectionReason: rejectDepositDto.rejectionReason.trim(),
      updatedAt: new Date(),
    });
  }

  private async createApprovedDeposit(params: {
    userId: string;
    provider: PaymentProvider;
    amount: Prisma.Decimal;
    transactionRef: string;
    verification: VerifyDepositResult;
  }) {
    const verifiedAt = new Date();
    const verifiedAmount = params.verification.amount
      ? new Prisma.Decimal(params.verification.amount)
      : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const deposit = await tx.deposit.create({
          data: {
            userId: params.userId,
            provider: params.provider,
            amount: params.amount,
            transactionRef: params.transactionRef,
            status: DepositStatus.APPROVED,
            verifiedAt,
            verifyEtRequestId: params.verification.requestId,
            verifyEtRawResponse:
              params.verification.rawResponse as Prisma.InputJsonValue,
            verifiedAmount,
            verifiedReceiverName: params.verification.receiverName,
            verifiedData: {
              verificationSource: 'verify.et',
              decision: 'APPROVED',
            },
          },
          select: adminDepositSelect,
        });

        const walletTransactionId = await this.walletService.creditWallet(
          tx,
          deposit.userId,
          deposit.amount,
          {
            type: WalletTransactionType.DEPOSIT,
            referenceType: 'deposit',
            referenceId: deposit.id,
            description: `Approved ${deposit.provider} deposit`,
          },
        );

        if (walletTransactionId) {
          await tx.deposit.update({
            where: { id: deposit.id },
            data: { walletTransactionId },
          });
        }

        const updatedDeposit = await tx.deposit.findUnique({
          where: { id: deposit.id },
          select: adminDepositSelect,
        });

        if (!updatedDeposit) {
          throw new NotFoundException('Deposit not found after approval');
        }

        return updatedDeposit;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.buildDepositException('ALREADY_USED');
      }

      throw error;
    }
  }

  private async approveDepositRecord(
    depositId: string,
    verificationSource: string,
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

      if (existingDeposit.status === DepositStatus.APPROVED) {
        return existingDeposit;
      }

      if (!updatableDepositStatuses.includes(existingDeposit.status)) {
        throw new BadRequestException('Deposit cannot be approved');
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
          verifiedData: {
            verificationSource,
            decision: 'APPROVED',
          },
        },
      });

      if (updateResult.count !== 1) {
        throw new BadRequestException('Deposit cannot be approved');
      }

      const walletTransactionId = await this.walletService.creditWallet(
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

      if (walletTransactionId) {
        await tx.deposit.update({
          where: { id: depositId },
          data: { walletTransactionId },
        });
      }

      if (actorId) {
        await this.auditLogService.create(tx, {
          actorId,
          action: 'admin.deposit.approve',
          entity: 'Deposit',
          entityId: existingDeposit.id,
          metadata: {
            provider: existingDeposit.provider,
            amount: existingDeposit.amount.toString(),
            verificationSource,
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

  private evaluateVerification(
    submittedAmount: Prisma.Decimal,
    verification: VerifyDepositResult,
  ): {
    status: TerminalDepositStatus;
    rejectionReason?: string;
    errorCode?: DepositErrorCode;
  } {
    if (verification.errorCode === 'VERIFICATION_UNAVAILABLE') {
      return {
        status: DepositStatus.REJECTED,
        errorCode: 'VERIFICATION_UNAVAILABLE',
        rejectionReason: DEPOSIT_ERROR_MESSAGES.VERIFICATION_UNAVAILABLE,
      };
    }

    if (!verification.verified) {
      return {
        status: DepositStatus.REJECTED,
        errorCode: verification.errorCode ?? 'INVALID_RECEIPT',
        rejectionReason:
          verification.reason ?? DEPOSIT_ERROR_MESSAGES.INVALID_RECEIPT,
      };
    }

    if (!verification.settlementMatched) {
      return {
        status: DepositStatus.REJECTED,
        errorCode: 'SETTLEMENT_MISMATCH',
        rejectionReason: DEPOSIT_ERROR_MESSAGES.SETTLEMENT_MISMATCH,
      };
    }

    if (!verification.amount) {
      return {
        status: DepositStatus.REJECTED,
        errorCode: 'INVALID_RECEIPT',
        rejectionReason: DEPOSIT_ERROR_MESSAGES.INVALID_RECEIPT,
      };
    }

    try {
      const providerAmount = new Prisma.Decimal(verification.amount);
      if (!providerAmount.equals(submittedAmount)) {
        return {
          status: DepositStatus.REJECTED,
          errorCode: 'AMOUNT_MISMATCH',
          rejectionReason: DEPOSIT_ERROR_MESSAGES.AMOUNT_MISMATCH,
        };
      }
    } catch {
      return {
        status: DepositStatus.REJECTED,
        errorCode: 'INVALID_RECEIPT',
        rejectionReason: DEPOSIT_ERROR_MESSAGES.INVALID_RECEIPT,
      };
    }

    return { status: DepositStatus.APPROVED };
  }

  private async ensureReferenceAvailable(
    provider: PaymentProvider,
    transactionRef: string,
  ) {
    const existing = await this.findDepositByReference(provider, transactionRef);
    if (existing) {
      throw this.buildDepositException('ALREADY_USED');
    }
  }

  private async findDepositByReference(
    provider: PaymentProvider,
    transactionRef: string,
  ) {
    return this.prisma.deposit.findFirst({
      where: {
        provider,
        transactionRef,
        status: DepositStatus.APPROVED,
      },
      select: { id: true, status: true },
    });
  }

  private buildDepositException(code: DepositErrorCode, message?: string) {
    const resolvedMessage = message ?? DEPOSIT_ERROR_MESSAGES[code];
    if (code === 'ALREADY_USED') {
      return new ConflictException({
        message: resolvedMessage,
        code,
      });
    }

    return new BadRequestException({
      message: resolvedMessage,
      code,
    });
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

  private async emitDepositApprovedPush(
    userId: string,
    depositId: string,
    amount: Prisma.Decimal,
  ) {
    try {
      await this.notificationsService.sendAppNotificationToUser(userId, {
        category: 'DEPOSIT_APPROVED',
        title: 'Deposit approved',
        body: `${DEPOSIT_APPROVED_MESSAGE} ${amount.toString()} ETB added to your wallet.`,
        route: '/wallet/deposits',
        entityId: depositId,
        data: {
          depositId,
          amount: amount.toString(),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send DEPOSIT_APPROVED push for deposit ${depositId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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

  private ensureTransactionRefFormat(transactionRef: string): void {
    if (!/^[A-Z0-9-]{6,120}$/.test(transactionRef)) {
      throw new BadRequestException(
        'transactionRef must be 6 to 120 alphanumeric characters',
      );
    }
  }

  private normalizeDigits(value: string): string {
    return value.replace(/\D/g, '');
  }
}
