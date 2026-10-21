import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DepositApprovalMode,
  DepositStatus,
  DepositVerificationAttempt,
  DepositVerificationAttemptStatus,
  PaymentProvider,
  Prisma,
  WalletTransactionType,
} from '@prisma/client';
import { DepositApprovalConfigService } from '../deposit-approval-config/deposit-approval-config.service';
import { TelebirrReceiptFetchService } from '../deposit-approval-config/telebirr-receipt-fetch.service';
import { validateTelebirrLocalReceipt } from '../deposit-approval-config/telebirr-local-receipt.validator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AdminDepositsQueryDto } from './dto/admin-deposits-query.dto';
import { AuditLogService } from '../common/services/audit-log.service';
import { UserActionRateLimitService } from '../common/rate-limit/user-action-rate-limit.service';
import {
  buildPaginationMeta,
  getPaginationParams,
} from '../common/utils/pagination.util';
import { NotificationsService } from '../notifications/notifications.service';
import { pushNotificationMessages } from '../notifications/push-notification-messages';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { VerifyEtService } from '../verify-et/verify-et.service';
import { VerifyDepositResult } from '../verify-et/verify-et.types';
import { WalletService } from '../wallet/wallet.service';
import {
  ACTIVE_VERIFICATION_ATTEMPT_STATUSES,
  DEFAULT_VERIFICATION_RETRY_AFTER_SECONDS,
  VERIFICATION_ATTEMPT_TTL_MS,
  VERIFICATION_CHECK_POLL_ATTEMPTS,
  VERIFICATION_INITIAL_POLL_ATTEMPTS,
} from './deposit-verification-attempt.constants';
import {
  DEPOSIT_CHECK_REF_OK_MESSAGE,
  DEPOSIT_ERROR_MESSAGES,
  DepositErrorCode,
} from './deposit-verification.errors';
import {
  createDepositVerificationCorrelationId,
  fingerprintIdempotencyKey,
  logDepositVerificationEvent,
  maskDepositRef,
} from './deposit-verification.observability';
import { canonicalizeDepositTransactionRef } from './deposit-transaction-reference';
import { CheckDepositReferenceDto } from './dto/check-deposit-reference.dto';
import { ApproveDepositDto } from './dto/approve-deposit.dto';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { PendingDepositVerificationResponse } from './dto/pending-deposit-verification.response';
import { RejectDepositDto } from './dto/reject-deposit.dto';
import { TelebirrReceiptParseStatus } from './dto/telebirr-receipt-parse-status.enum';
import { serializeAdminDeposit, serializeDeposit } from './deposits.mapper';
import {
  adminDepositSelect,
  depositSelect,
  updatableDepositStatuses,
} from './deposits.select';
import { buildVerifyEtIdempotencyKey } from '../verify-et/verify-et.client';
import { VERIFY_ET_BANK_KEYS } from '../verify-et/verify-et.constants';

type CheckReferenceCode = 'OK' | 'ALREADY_USED' | 'UNDER_REVIEW';
type TerminalDepositStatus = Extract<DepositStatus, 'APPROVED' | 'REJECTED'>;

const DEPOSIT_MANUAL_APPROVAL_PIN = '121921';

@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly verifyEtService: VerifyEtService,
    private readonly depositApprovalConfigService: DepositApprovalConfigService,
    private readonly telebirrReceiptFetchService: TelebirrReceiptFetchService,
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
    this.userActionRateLimitService.assertWithinLimit(
      'deposit_request',
      userId,
    );
    const amount = this.parseAmount(createDepositDto.amount);
    const approvalMode = await this.depositApprovalConfigService.getMode(
      createDepositDto.provider,
    );
    const transactionRef = this.normalizeTransactionRef(
      createDepositDto.transactionRef,
      createDepositDto.provider,
      approvalMode,
    );
    this.ensureTransactionRefFormat(transactionRef);

    const existing = await this.ensureReferenceAvailable(
      createDepositDto.provider,
      transactionRef,
      userId,
    );
    if (existing) {
      this.logger.log(
        `Idempotent retry for deposit ref=${transactionRef} by user ${userId}. Returning existing deposit with status ${existing.status}`,
      );
      return serializeDeposit(existing);
    }

    if (approvalMode === DepositApprovalMode.MANUAL) {
      return this.createManualPendingDeposit({
        userId,
        provider: createDepositDto.provider,
        amount,
        transactionRef,
        createDepositDto,
      });
    }

    if (
      approvalMode === DepositApprovalMode.LOCAL &&
      createDepositDto.provider === PaymentProvider.TELEBIRR
    ) {
      return this.createLocalTelebirrDeposit({
        userId,
        amount,
        transactionRef,
        createDepositDto,
      });
    }

    if (
      approvalMode === DepositApprovalMode.LOCAL &&
      createDepositDto.provider !== PaymentProvider.TELEBIRR
    ) {
      throw new BadRequestException(
        'Local approval mode is only supported for Telebirr.',
      );
    }

    return this.createAutomaticDeposit({
      userId,
      provider: createDepositDto.provider,
      amount,
      transactionRef,
      createDepositDto,
    });
  }

  private async createAutomaticDeposit(params: {
    userId: string;
    provider: PaymentProvider;
    amount: Prisma.Decimal;
    transactionRef: string;
    createDepositDto: CreateDepositDto;
  }) {
    return this.runAutomaticVerification({
      userId: params.userId,
      provider: params.provider,
      amount: params.amount,
      transactionRef: params.transactionRef,
      resumeAttemptId: null,
      allowNewSubmit: true,
      maxPollAttempts: VERIFICATION_INITIAL_POLL_ATTEMPTS,
    });
  }

  async checkVerificationAttempt(userId: string, attemptId: string) {
    this.userActionRateLimitService.assertWithinLimit(
      'deposit_request',
      userId,
    );
    const attempt = await this.prisma.depositVerificationAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt || attempt.userId !== userId) {
      throw new NotFoundException('Verification attempt not found');
    }

    return this.runAutomaticVerification({
      userId,
      provider: attempt.provider,
      amount: attempt.amount,
      transactionRef: attempt.transactionRef,
      resumeAttemptId: attempt.id,
      allowNewSubmit: false,
      maxPollAttempts: VERIFICATION_CHECK_POLL_ATTEMPTS,
    });
  }

  /**
   * Player-initiated cancel: expire an active verification attempt immediately
   * so the same receipt is no longer locked for a new submit. Idempotent when
   * the attempt is already terminal (SUCCEEDED / FAILED / EXPIRED).
   */
  async cancelVerificationAttempt(userId: string, attemptId: string) {
    this.userActionRateLimitService.assertWithinLimit(
      'deposit_request',
      userId,
    );
    const attempt = await this.prisma.depositVerificationAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt || attempt.userId !== userId) {
      throw new NotFoundException('Verification attempt not found');
    }

    if (!ACTIVE_VERIFICATION_ATTEMPT_STATUSES.includes(attempt.status)) {
      return {
        attemptId: attempt.id,
        status: 'EXPIRED' as const,
        cancelled: attempt.status === DepositVerificationAttemptStatus.EXPIRED,
      };
    }

    const updated = await this.prisma.depositVerificationAttempt.updateMany({
      where: {
        id: attempt.id,
        userId,
        status: { in: ACTIVE_VERIFICATION_ATTEMPT_STATUSES },
      },
      data: {
        status: DepositVerificationAttemptStatus.EXPIRED,
        expiresAt: new Date(),
        lastErrorCode: 'CANCELLED_BY_USER',
        lastErrorMessage: 'Cancelled by player',
      },
    });

    logDepositVerificationEvent(this.logger, {
      correlationId: attempt.correlationId ?? createDepositVerificationCorrelationId(),
      provider: attempt.provider,
      approvalMode: 'automatic',
      verificationSource: 'verify.et',
      providerRequestId: attempt.providerRequestId ?? undefined,
      stage: 'cancel',
      outcome: updated.count === 1 ? 'pending' : 'unavailable',
      refSuffix: maskDepositRef(attempt.transactionRef),
      message:
        updated.count === 1
          ? `cancelled attemptId=${attempt.id}`
          : `cancel race attemptId=${attempt.id}`,
    });

    return {
      attemptId: attempt.id,
      status: 'EXPIRED' as const,
      cancelled: true,
    };
  }

  async getActiveVerificationAttempt(
    userId: string,
    provider: PaymentProvider,
    transactionRefRaw: string,
  ) {
    const approvalMode = await this.depositApprovalConfigService.getMode(
      provider,
    );
    const transactionRef = this.normalizeTransactionRef(
      transactionRefRaw,
      provider,
      approvalMode,
    );
    this.ensureTransactionRefFormat(transactionRef);

    const attempt = await this.prisma.depositVerificationAttempt.findFirst({
      where: {
        userId,
        provider,
        transactionRef,
        status: { in: ACTIVE_VERIFICATION_ATTEMPT_STATUSES },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!attempt) {
      return null;
    }

    return this.toPendingVerificationResponse(
      attempt,
      'VERIFICATION_PENDING',
      DEPOSIT_ERROR_MESSAGES.VERIFICATION_PENDING,
    );
  }

  private async runAutomaticVerification(params: {
    userId: string;
    provider: PaymentProvider;
    amount: Prisma.Decimal;
    transactionRef: string;
    resumeAttemptId: string | null;
    allowNewSubmit: boolean;
    maxPollAttempts: number;
  }): Promise<
    ReturnType<typeof serializeDeposit> | PendingDepositVerificationResponse
  > {
    const correlationId = createDepositVerificationCorrelationId();
    const refSuffix = maskDepositRef(params.transactionRef);

    await this.ensureReferenceAvailable(
      params.provider,
      params.transactionRef,
    );

    let attempt = params.resumeAttemptId
      ? await this.prisma.depositVerificationAttempt.findUnique({
          where: { id: params.resumeAttemptId },
        })
      : await this.findActiveVerificationAttempt(
          params.provider,
          params.transactionRef,
        );

    if (attempt) {
      attempt = await this.expireAttemptIfNeeded(attempt);
      if (attempt.status === DepositVerificationAttemptStatus.EXPIRED) {
        attempt = null;
      }
    }

    if (attempt && attempt.userId !== params.userId) {
      throw this.buildDepositException('UNDER_REVIEW');
    }

    if (
      attempt &&
      attempt.status === DepositVerificationAttemptStatus.SUCCEEDED &&
      attempt.depositId
    ) {
      const deposit = await this.prisma.deposit.findUnique({
        where: { id: attempt.depositId },
        select: adminDepositSelect,
      });
      if (deposit) {
        return serializeDeposit(deposit);
      }
    }

    if (attempt?.status === DepositVerificationAttemptStatus.FAILED) {
      throw this.buildDepositException(
        (attempt.lastErrorCode as DepositErrorCode) ?? 'INVALID_TRANSACTION',
        attempt.lastErrorMessage ?? undefined,
      );
    }

    if (
      attempt &&
      !attempt.amount.equals(params.amount) &&
      ACTIVE_VERIFICATION_ATTEMPT_STATUSES.includes(attempt.status)
    ) {
      throw new BadRequestException({
        message:
          'A verification is already in progress for this receipt with a different amount. Wait for it to finish or expire, then retry with the correct amount.',
        code: 'AMOUNT_MISMATCH',
      });
    }

    if (!attempt) {
      if (!params.allowNewSubmit) {
        throw new NotFoundException('Verification attempt not found');
      }
      attempt = await this.createVerificationAttempt({
        userId: params.userId,
        provider: params.provider,
        amount: params.amount,
        transactionRef: params.transactionRef,
        correlationId,
      });
    }

    const shouldAvoidNewPost = this.shouldAvoidNewProviderSubmit(
      attempt,
      params.allowNewSubmit,
    );
    const canResume =
      Boolean(attempt.providerRequestId) &&
      (attempt.status === DepositVerificationAttemptStatus.AWAITING_PROVIDER ||
        attempt.status === DepositVerificationAttemptStatus.AMBIGUOUS ||
        attempt.status === DepositVerificationAttemptStatus.SUBMITTING);

    if (!canResume && shouldAvoidNewPost) {
      // Do not flip SUBMIT_IN_FLIGHT / Check Again blockers to AMBIGUOUS —
      // that would race a living submitter. Only heal broken AWAITING rows.
      if (
        attempt.status ===
          DepositVerificationAttemptStatus.AWAITING_PROVIDER &&
        !attempt.providerRequestId
      ) {
        await this.markAttemptAmbiguous(attempt.id, correlationId);
      }
      return this.toPendingVerificationResponse(
        attempt,
        'VERIFICATION_PENDING',
        DEPOSIT_ERROR_MESSAGES.VERIFICATION_PENDING,
      );
    }

    if (!canResume && !params.allowNewSubmit) {
      return this.toPendingVerificationResponse(
        attempt,
        'VERIFICATION_PENDING',
        DEPOSIT_ERROR_MESSAGES.VERIFICATION_PENDING,
      );
    }

    if (!canResume && params.allowNewSubmit) {
      const claimedSubmit = await this.claimProviderSubmit(
        attempt.id,
        correlationId,
      );
      if (!claimedSubmit) {
        return this.toPendingVerificationResponse(
          attempt,
          'VERIFICATION_PENDING',
          DEPOSIT_ERROR_MESSAGES.VERIFICATION_PENDING,
        );
      }
    }

    let verification: VerifyDepositResult;
    try {
      verification = await this.verifyEtService.verifyDeposit({
        provider: params.provider,
        reference: params.transactionRef,
        amount: params.amount.toString(),
        correlationId,
        maxPollAttempts: params.maxPollAttempts,
        existingRequestId: canResume
          ? (attempt.providerRequestId ?? undefined)
          : undefined,
        onRequestId: async (requestId) => {
          await this.persistProviderRequestId({
            attemptId: attempt!.id,
            requestId,
            correlationId,
            provider: params.provider,
            transactionRef: params.transactionRef,
          });
          attempt = {
            ...attempt!,
            providerRequestId: requestId,
            status: DepositVerificationAttemptStatus.AWAITING_PROVIDER,
          };
        },
      });
    } catch (error) {
      if (!attempt.providerRequestId) {
        await this.markAttemptAmbiguous(attempt.id, correlationId);
      }
      throw error;
    }

    if (
      verification.requestId &&
      verification.requestId !== attempt.providerRequestId
    ) {
      await this.persistProviderRequestId({
        attemptId: attempt.id,
        requestId: verification.requestId,
        correlationId,
        provider: params.provider,
        transactionRef: params.transactionRef,
      });
      attempt = {
        ...attempt,
        providerRequestId: verification.requestId,
        status: DepositVerificationAttemptStatus.AWAITING_PROVIDER,
      };
    }

    const decision = this.evaluateVerification(params.amount, verification);
    logDepositVerificationEvent(this.logger, {
      correlationId,
      provider: params.provider,
      approvalMode: 'automatic',
      verificationSource: 'verify.et',
      providerRequestId:
        verification.requestId ?? attempt.providerRequestId ?? undefined,
      stage: 'evaluate',
      processingStatus: verification.processingStatus,
      pollCount: verification.pollCount,
      pollElapsedMs: verification.pollElapsedMs,
      errorCode: decision.errorCode,
      outcome:
        decision.status === DepositStatus.APPROVED
          ? 'approved'
          : decision.errorCode === 'VERIFICATION_PENDING'
            ? 'pending'
            : decision.errorCode === 'VERIFICATION_UNAVAILABLE'
              ? 'unavailable'
              : 'rejected',
      refSuffix,
      message: `attemptId=${attempt.id}`,
    });

    if (
      decision.errorCode === 'VERIFICATION_PENDING' ||
      decision.errorCode === 'VERIFICATION_UNAVAILABLE'
    ) {
      await this.prisma.depositVerificationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: DepositVerificationAttemptStatus.AWAITING_PROVIDER,
          correlationId,
          lastErrorCode: decision.errorCode,
          lastErrorMessage: decision.rejectionReason,
        },
      });
      return this.toPendingVerificationResponse(
        attempt,
        decision.errorCode,
        decision.rejectionReason ?? DEPOSIT_ERROR_MESSAGES[decision.errorCode],
      );
    }

    if (decision.status !== DepositStatus.APPROVED) {
      await this.prisma.depositVerificationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: DepositVerificationAttemptStatus.FAILED,
          lastErrorCode: decision.errorCode ?? 'INVALID_TRANSACTION',
          lastErrorMessage: decision.rejectionReason,
          correlationId,
        },
      });
      throw this.buildDepositException(
        decision.errorCode ?? 'INVALID_TRANSACTION',
        decision.rejectionReason,
      );
    }

    return this.finalizeAutomaticApproval({
      attempt,
      userId: params.userId,
      provider: params.provider,
      amount: params.amount,
      transactionRef: params.transactionRef,
      verification,
      correlationId,
      refSuffix,
    });
  }

  /**
   * Concurrent Check Again safety: only one request creates the Deposit +
   * wallet credit; losers return the existing approved deposit (or a
   * recoverable pending response) without re-emitting sockets/push.
   */
  private async finalizeAutomaticApproval(params: {
    attempt: DepositVerificationAttempt;
    userId: string;
    provider: PaymentProvider;
    amount: Prisma.Decimal;
    transactionRef: string;
    verification: VerifyDepositResult;
    correlationId: string;
    refSuffix: string;
  }): Promise<
    ReturnType<typeof serializeDeposit> | PendingDepositVerificationResponse
  > {
    const existingApproved = await this.prisma.deposit.findFirst({
      where: {
        provider: params.provider,
        transactionRef: params.transactionRef,
        status: DepositStatus.APPROVED,
      },
      select: adminDepositSelect,
    });
    if (existingApproved) {
      await this.markAttemptSucceeded(
        params.attempt.id,
        existingApproved.id,
        params.correlationId,
      );
      return serializeDeposit(existingApproved);
    }

    const claim = await this.prisma.depositVerificationAttempt.updateMany({
      where: {
        id: params.attempt.id,
        status: { in: ACTIVE_VERIFICATION_ATTEMPT_STATUSES },
        depositId: null,
        NOT: { lastErrorCode: 'COMPLETING' },
      },
      data: {
        correlationId: params.correlationId,
        lastErrorCode: 'COMPLETING',
        lastErrorMessage: 'Claimed for automatic approval',
      },
    });

    if (claim.count !== 1) {
      const latest = await this.prisma.depositVerificationAttempt.findUnique({
        where: { id: params.attempt.id },
      });
      if (latest?.status === DepositVerificationAttemptStatus.SUCCEEDED) {
        if (latest.depositId) {
          const deposit = await this.prisma.deposit.findUnique({
            where: { id: latest.depositId },
            select: adminDepositSelect,
          });
          if (deposit) {
            return serializeDeposit(deposit);
          }
        }
      }
      const racedApproved = await this.prisma.deposit.findFirst({
        where: {
          provider: params.provider,
          transactionRef: params.transactionRef,
          status: DepositStatus.APPROVED,
        },
        select: adminDepositSelect,
      });
      if (racedApproved) {
        await this.markAttemptSucceeded(
          params.attempt.id,
          racedApproved.id,
          params.correlationId,
        );
        return serializeDeposit(racedApproved);
      }
      // Winner is still creating the deposit — recoverable, do not credit again.
      return this.toPendingVerificationResponse(
        params.attempt,
        'VERIFICATION_PENDING',
        DEPOSIT_ERROR_MESSAGES.VERIFICATION_PENDING,
      );
    }

    let approvedDeposit;
    let createdInThisRequest = false;
    try {
      approvedDeposit = await this.createApprovedDeposit({
        userId: params.userId,
        provider: params.provider,
        amount: params.amount,
        transactionRef: params.transactionRef,
        verification: params.verification,
        verifiedData: {
          verificationSource: 'verify.et',
          approvalModeAtSubmit: 'automatic',
          decision: 'APPROVED',
          correlationId: params.correlationId,
          verificationAttemptId: params.attempt.id,
          ...(params.verification.matchedSettlementAccount
            ? {
                matchedSettlementAccount:
                  params.verification.matchedSettlementAccount,
              }
            : {}),
        },
      });
      createdInThisRequest = true;
    } catch (error) {
      if (
        error instanceof ConflictException ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002')
      ) {
        const racedApproved = await this.prisma.deposit.findFirst({
          where: {
            provider: params.provider,
            transactionRef: params.transactionRef,
            status: DepositStatus.APPROVED,
          },
          select: adminDepositSelect,
        });
        if (racedApproved) {
          await this.markAttemptSucceeded(
            params.attempt.id,
            racedApproved.id,
            params.correlationId,
          );
          return serializeDeposit(racedApproved);
        }
      }

      await this.prisma.depositVerificationAttempt.updateMany({
        where: {
          id: params.attempt.id,
          status: { in: ACTIVE_VERIFICATION_ATTEMPT_STATUSES },
          lastErrorCode: 'COMPLETING',
        },
        data: {
          status: DepositVerificationAttemptStatus.AWAITING_PROVIDER,
          lastErrorCode: 'VERIFICATION_UNAVAILABLE',
          lastErrorMessage:
            'Automatic approval claim released after create failure',
        },
      });
      throw error;
    }

    await this.markAttemptSucceeded(
      params.attempt.id,
      approvedDeposit.id,
      params.correlationId,
    );

    logDepositVerificationEvent(this.logger, {
      correlationId: params.correlationId,
      provider: params.provider,
      approvalMode: 'automatic',
      verificationSource: 'verify.et',
      providerRequestId: params.verification.requestId,
      stage: 'final',
      outcome: 'approved',
      refSuffix: params.refSuffix,
      message: `attemptId=${params.attempt.id}`,
    });

    if (createdInThisRequest) {
      this.emitDepositUpdated(approvedDeposit);
      await this.emitWalletUpdated(approvedDeposit.userId);
      await this.emitDepositApprovedPush(
        approvedDeposit.userId,
        approvedDeposit.id,
        approvedDeposit.amount,
      );
    }

    return serializeDeposit(approvedDeposit);
  }

  private async markAttemptSucceeded(
    attemptId: string,
    depositId: string,
    correlationId: string,
  ) {
    await this.prisma.depositVerificationAttempt.update({
      where: { id: attemptId },
      data: {
        status: DepositVerificationAttemptStatus.SUCCEEDED,
        depositId,
        correlationId,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  }

  private async findActiveVerificationAttempt(
    provider: PaymentProvider,
    transactionRef: string,
  ) {
    return this.prisma.depositVerificationAttempt.findFirst({
      where: {
        provider,
        transactionRef,
        status: { in: ACTIVE_VERIFICATION_ATTEMPT_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async createVerificationAttempt(params: {
    userId: string;
    provider: PaymentProvider;
    amount: Prisma.Decimal;
    transactionRef: string;
    correlationId: string;
  }) {
    const expiresAt = new Date(Date.now() + VERIFICATION_ATTEMPT_TTL_MS);
    const idempotencyKeyFingerprint = this.buildAttemptIdempotencyFingerprint(
      params.provider,
      params.transactionRef,
    );

    try {
      return await this.prisma.depositVerificationAttempt.create({
        data: {
          userId: params.userId,
          provider: params.provider,
          amount: params.amount,
          transactionRef: params.transactionRef,
          status: DepositVerificationAttemptStatus.SUBMITTING,
          correlationId: params.correlationId,
          idempotencyKeyFingerprint,
          expiresAt,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.findActiveVerificationAttempt(
          params.provider,
          params.transactionRef,
        );
        if (existing) {
          if (existing.userId !== params.userId) {
            throw this.buildDepositException('UNDER_REVIEW');
          }
          return existing;
        }
      }
      throw error;
    }
  }

  private buildAttemptIdempotencyFingerprint(
    provider: PaymentProvider,
    transactionRef: string,
  ): string {
    const settlementAccount =
      provider === PaymentProvider.TELEBIRR
        ? (this.configService.get<string>('TELEBIRR_SETTLEMENT_ACCOUNT') ?? '')
        : provider === PaymentProvider.CBE
          ? (this.configService.get<string>('CBE_SETTLEMENT_ACCOUNT') ?? '')
          : '';
    const body: Record<string, string> =
      provider === PaymentProvider.TELEBIRR
        ? {
            bank: VERIFY_ET_BANK_KEYS.TELEBIRR,
            transactionNumber: transactionRef,
            settlementAccount,
          }
        : {
            bank: VERIFY_ET_BANK_KEYS.CBE,
            referenceNumber: transactionRef,
            settlementAccount,
          };
    const key = buildVerifyEtIdempotencyKey(
      `${provider.toLowerCase()}-${transactionRef}`,
      body,
    );
    return fingerprintIdempotencyKey(key);
  }

  /**
   * Fail closed: without a persisted provider requestId, never create a second
   * Verify.ET POST. The initial submitter may POST after claimProviderSubmit;
   * Check Again and concurrent duplicates must not POST until EXPIRED.
   */
  private shouldAvoidNewProviderSubmit(
    attempt: DepositVerificationAttempt,
    allowNewSubmit: boolean,
  ): boolean {
    if (attempt.providerRequestId) {
      return false;
    }
    if (attempt.status === DepositVerificationAttemptStatus.AMBIGUOUS) {
      return true;
    }
    if (attempt.status === DepositVerificationAttemptStatus.AWAITING_PROVIDER) {
      return true;
    }
    if (attempt.status === DepositVerificationAttemptStatus.SUBMITTING) {
      if (!allowNewSubmit) {
        return true;
      }
      return attempt.lastErrorCode === 'SUBMIT_IN_FLIGHT';
    }
    return false;
  }

  private async claimProviderSubmit(
    attemptId: string,
    correlationId: string,
  ): Promise<boolean> {
    const claim = await this.prisma.depositVerificationAttempt.updateMany({
      where: {
        id: attemptId,
        status: DepositVerificationAttemptStatus.SUBMITTING,
        providerRequestId: null,
        NOT: { lastErrorCode: 'SUBMIT_IN_FLIGHT' },
      },
      data: {
        correlationId,
        lastErrorCode: 'SUBMIT_IN_FLIGHT',
        lastErrorMessage: 'Claimed for Verify.ET submit',
      },
    });
    return claim.count === 1;
  }

  private async expireAttemptIfNeeded(attempt: DepositVerificationAttempt) {
    if (
      ACTIVE_VERIFICATION_ATTEMPT_STATUSES.includes(attempt.status) &&
      attempt.expiresAt.getTime() <= Date.now()
    ) {
      return this.prisma.depositVerificationAttempt.update({
        where: { id: attempt.id },
        data: { status: DepositVerificationAttemptStatus.EXPIRED },
      });
    }
    return attempt;
  }

  private async persistProviderRequestId(params: {
    attemptId: string;
    requestId: string;
    correlationId: string;
    provider: PaymentProvider;
    transactionRef: string;
  }) {
    await this.prisma.depositVerificationAttempt.update({
      where: { id: params.attemptId },
      data: {
        providerRequestId: params.requestId,
        status: DepositVerificationAttemptStatus.AWAITING_PROVIDER,
        correlationId: params.correlationId,
      },
    });
    logDepositVerificationEvent(this.logger, {
      correlationId: params.correlationId,
      provider: params.provider,
      approvalMode: 'automatic',
      verificationSource: 'verify.et',
      providerRequestId: params.requestId,
      stage: 'submit',
      outcome: 'pending',
      refSuffix: maskDepositRef(params.transactionRef),
      message: `persisted requestId attemptId=${params.attemptId}`,
    });
  }

  private async markAttemptAmbiguous(attemptId: string, correlationId: string) {
    await this.prisma.depositVerificationAttempt.update({
      where: { id: attemptId },
      data: {
        status: DepositVerificationAttemptStatus.AMBIGUOUS,
        correlationId,
      },
    });
  }

  private toPendingVerificationResponse(
    attempt: Pick<
      DepositVerificationAttempt,
      'id' | 'provider' | 'amount' | 'transactionRef'
    >,
    code: 'VERIFICATION_PENDING' | 'VERIFICATION_UNAVAILABLE',
    message: string,
  ): PendingDepositVerificationResponse {
    return {
      verificationStatus: 'pending',
      attemptId: attempt.id,
      code,
      message,
      retryAfterSeconds: DEFAULT_VERIFICATION_RETRY_AFTER_SECONDS,
      provider: attempt.provider,
      amount: attempt.amount.toString(),
      transactionRef: attempt.transactionRef,
    };
  }

  private async createManualPendingDeposit(params: {
    userId: string;
    provider: PaymentProvider;
    amount: Prisma.Decimal;
    transactionRef: string;
    createDepositDto: CreateDepositDto;
  }) {
    try {
      const deposit = await this.prisma.deposit.create({
        data: {
          userId: params.userId,
          provider: params.provider,
          amount: params.amount,
          transactionRef: params.transactionRef,
          receiptUrl:
            params.provider === PaymentProvider.CBE &&
            /^https?:\/\//i.test(params.createDepositDto.transactionRef)
              ? params.createDepositDto.transactionRef.trim()
              : null,
          status: DepositStatus.PENDING,
          verifiedData: {
            verificationSource: 'manual.pending',
            approvalModeAtSubmit: 'manual',
            ...(params.createDepositDto.clientReceipt
              ? {
                  clientReceipt: params.createDepositDto
                    .clientReceipt as unknown as Prisma.InputJsonValue,
                }
              : {}),
            ...(params.createDepositDto.receiptParseStatus
              ? {
                  receiptParseStatus:
                    params.createDepositDto.receiptParseStatus,
                }
              : {}),
          },
        },
        select: adminDepositSelect,
      });

      this.emitDepositUpdated(deposit);
      return serializeDeposit(deposit);
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

  private async createLocalTelebirrDeposit(params: {
    userId: string;
    amount: Prisma.Decimal;
    transactionRef: string;
    createDepositDto: CreateDepositDto;
  }) {
    const correlationId = createDepositVerificationCorrelationId();
    const refSuffix = maskDepositRef(params.transactionRef);

    let clientReceipt = params.createDepositDto.clientReceipt;
    let receiptParseStatus = params.createDepositDto.receiptParseStatus;

    // Optional server fallback only when the client did not supply a parse
    // (original befb356). Happy path uses Flutter evidence and does not require
    // VPS reachability to Ethio Telecom.
    if (
      receiptParseStatus !== TelebirrReceiptParseStatus.PARSED ||
      !clientReceipt
    ) {
      const fetchedReceipt =
        await this.telebirrReceiptFetchService.fetchClientReceipt(
          params.transactionRef,
        );
      if (fetchedReceipt) {
        clientReceipt = fetchedReceipt;
        receiptParseStatus = TelebirrReceiptParseStatus.PARSED;
      }
    }

    // Local mode tries to validate client-parsed receipt. If client preview was
    // unavailable (e.g. carrier timeout), gracefully fallback to PENDING deposit for admin review.
    if (
      receiptParseStatus === TelebirrReceiptParseStatus.UNAVAILABLE ||
      !clientReceipt
    ) {
      this.logger.warn(
        `Local Telebirr receipt unparsed for ref=${params.transactionRef}; queueing as pending deposit for manual review`,
      );
      return this.createManualPendingDeposit({
        userId: params.userId,
        provider: PaymentProvider.TELEBIRR,
        amount: params.amount,
        transactionRef: params.transactionRef,
        createDepositDto: params.createDepositDto,
      });
    }

    const validation = validateTelebirrLocalReceipt({
      transactionRef: params.transactionRef,
      amount: params.amount,
      receiptParseStatus,
      clientReceipt,
      telebirrAccounts: this.getTelebirrAccounts(),
    });

    logDepositVerificationEvent(this.logger, {
      correlationId,
      provider: PaymentProvider.TELEBIRR,
      approvalMode: 'local',
      verificationSource: 'telebirr.local',
      stage: 'local_validate',
      errorCode: validation.ok ? undefined : validation.errorCode,
      outcome: validation.ok ? 'approved' : 'rejected',
      refSuffix,
      message: validation.ok
        ? 'client receipt validated; approving LOCAL deposit'
        : 'client receipt validation failed',
    });

    if (!validation.ok) {
      throw this.buildDepositException(
        validation.errorCode,
        validation.message,
      );
    }

    const approvedDeposit = await this.createApprovedDeposit({
      userId: params.userId,
      provider: PaymentProvider.TELEBIRR,
      amount: params.amount,
      transactionRef: params.transactionRef,
      verifiedAmount: validation.verifiedAmount,
      verifiedReceiverName: validation.verifiedReceiverName,
      verifiedData: {
        verificationSource: 'telebirr.local',
        approvalModeAtSubmit: 'local',
        decision: 'APPROVED',
        receiptAuthority: 'client.fetch',
        correlationId,
        clientReceipt:
          validation.clientReceipt as unknown as Prisma.InputJsonValue,
        receiptParseStatus: TelebirrReceiptParseStatus.PARSED,
      },
    });

    logDepositVerificationEvent(this.logger, {
      correlationId,
      provider: PaymentProvider.TELEBIRR,
      approvalMode: 'local',
      verificationSource: 'telebirr.local',
      stage: 'final',
      outcome: 'approved',
      refSuffix,
      message: `approved depositId=${approvedDeposit.id}`,
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
    const approvalMode = await this.depositApprovalConfigService.getMode(
      checkDepositReferenceDto.provider,
    );
    const transactionRef = this.normalizeTransactionRef(
      checkDepositReferenceDto.transactionRef,
      checkDepositReferenceDto.provider,
      approvalMode,
    );
    this.ensureTransactionRefFormat(transactionRef);

    const existing = await this.findActiveDepositByReference(
      checkDepositReferenceDto.provider,
      transactionRef,
    );

    if (existing?.status === DepositStatus.PENDING) {
      return {
        code: 'UNDER_REVIEW' as const,
        message: DEPOSIT_ERROR_MESSAGES.UNDER_REVIEW,
      };
    }

    if (existing?.status === DepositStatus.APPROVED) {
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

  async getDepositConfig() {
    const providerApprovalConfigs =
      await this.depositApprovalConfigService.getPlayerProviderConfigs();
    const approvalConfigByProvider = new Map(
      providerApprovalConfigs.map((entry) => [entry.key, entry]),
    );
    const telebirrAccounts = this.getTelebirrAccounts();
    const primaryTelebirrAccount = telebirrAccounts[0];
    const telebirrProviderName =
      this.configService.get<string>('TELEBIRR_PROVIDER_NAME') ?? 'Telebirr';

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
      [PaymentProvider.TELEBIRR]: primaryTelebirrAccount.settlementAccount,
      [PaymentProvider.CBE]:
        this.configService.get<string>('CBE_SETTLEMENT_ACCOUNT') ?? '',
      [PaymentProvider.AWASH]:
        this.configService.get<string>('AWASH_SETTLEMENT_ACCOUNT') ?? '',
      [PaymentProvider.BOA]:
        this.configService.get<string>('BOA_SETTLEMENT_ACCOUNT') ?? '',
    };

    const receiverNames: Record<PaymentProvider, string> = {
      [PaymentProvider.TELEBIRR]: primaryTelebirrAccount.receiverName,
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
      ].map((key) => {
        const approvalConfig = approvalConfigByProvider.get(key);
        return {
          key,
          name: providerNames[key],
          receiptCodeLabel: providerLabels[key],
          helpText: providerHelpText[key],
          requiresAmount: true,
          settlementAccount: settlementAccounts[key],
          receiverName: receiverNames[key],
          enabled: approvalConfig?.enabled ?? true,
          approvalMode: approvalConfig?.approvalMode ?? 'automatic',
          receiptBaseUrl:
            key === PaymentProvider.CBE
              ? this.getCbeReceiptBaseUrl()
              : undefined,
          guideVideoUrl:
            this.configService.get<string>(
              `DEPOSIT_GUIDE_YOUTUBE_${key}`,
            ) ?? '',
        };
      }),
      telebirr: {
        providerName: telebirrProviderName,
        receiptHelpText: providerHelpText[PaymentProvider.TELEBIRR],
        receiptBaseUrl:
          this.configService.get<string>('TELEBIRR_RECEIPT_BASE_URL') ??
          'https://transactioninfo.ethiotelecom.et/receipt',
        receiverPhoneLast4: primaryTelebirrAccount.receiverPhoneLast4,
        receiverName: primaryTelebirrAccount.receiverName,
        accounts: telebirrAccounts,
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

  async getAllDeposits(query: AdminDepositsQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(query);
    const where = this.buildAdminDepositsWhere(query);
    const [totalItems, deposits] = await Promise.all([
      this.prisma.deposit.count({ where }),
      this.prisma.deposit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: adminDepositSelect,
      }),
    ]);

    return {
      items: deposits.map(serializeAdminDeposit),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
      summary: {
        providers: (await this.getDepositConfig()).providers.map(
          (provider) => ({
            key: provider.key,
            name: provider.name,
          }),
        ),
      },
    };
  }

  async getPendingDepositCount() {
    const count = await this.prisma.deposit.count({
      where: { status: DepositStatus.PENDING },
    });
    return { count };
  }

  private buildAdminDepositsWhere(
    query: AdminDepositsQueryDto,
  ): Prisma.DepositWhereInput {
    const search = query.search?.trim();
    const createdAt = this.buildCreatedAtFilter(query.from, query.to);

    return {
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(search
        ? {
            OR: [
              {
                transactionRef: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                user: {
                  fullName: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                user: {
                  phoneNumber: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private buildCreatedAtFilter(
    from?: string,
    to?: string,
  ): Prisma.DateTimeFilter | undefined {
    const gte = from ? this.parseDateBoundary(from, 'start') : undefined;
    const lte = to ? this.parseDateBoundary(to, 'end') : undefined;

    if (!gte && !lte) {
      return undefined;
    }

    if (gte && lte && gte > lte) {
      throw new BadRequestException('from must be earlier than or equal to to');
    }

    return {
      ...(gte ? { gte } : {}),
      ...(lte ? { lte } : {}),
    };
  }

  private parseDateBoundary(rawValue: string, boundary: 'start' | 'end'): Date {
    const parsedDate = new Date(rawValue);

    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException(`Invalid ${boundary} date`);
    }

    if (!rawValue.includes('T')) {
      parsedDate.setHours(
        boundary === 'start' ? 0 : 23,
        boundary === 'start' ? 0 : 59,
        boundary === 'start' ? 0 : 59,
        boundary === 'start' ? 0 : 999,
      );
    }

    return parsedDate;
  }

  async approveDeposit(
    depositId: string,
    approveDepositDto: ApproveDepositDto,
    actorId?: string,
  ) {
    this.assertDepositApprovalPin(approveDepositDto.approvalPin);

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

      const rejectionReason = rejectDepositDto.rejectionReason.trim();
      const updatedDeposit = await tx.deposit.update({
        where: { id: depositId },
        data: {
          status: DepositStatus.REJECTED,
          rejectionReason,
          verifiedData: {
            ...(typeof existingDeposit.verifiedData === 'object' &&
            existingDeposit.verifiedData !== null &&
            !Array.isArray(existingDeposit.verifiedData)
              ? existingDeposit.verifiedData
              : {}),
            verificationSource: 'manual.admin.reject',
            rejectedByAdmin: true,
            decision: 'REJECTED',
          },
        },
        select: adminDepositSelect,
      });

      return updatedDeposit;
    });

    this.emitDepositUpdated(deposit);
    await this.emitDepositRejectedPush(
      deposit.userId,
      deposit.id,
      deposit.amount,
      rejectDepositDto.rejectionReason.trim(),
    );

    return serializeAdminDeposit(deposit);
  }

  private async createApprovedDeposit(params: {
    userId: string;
    provider: PaymentProvider;
    amount: Prisma.Decimal;
    transactionRef: string;
    verification?: VerifyDepositResult;
    verifiedData: Prisma.InputJsonValue;
    verifiedAmount?: Prisma.Decimal | null;
    verifiedReceiverName?: string | null;
  }) {
    const verifiedAt = new Date();
    const verifiedAmount =
      params.verifiedAmount ??
      (params.verification?.amount
        ? new Prisma.Decimal(params.verification.amount)
        : null);

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
            verifyEtRequestId: params.verification?.requestId,
            verifyEtRawResponse: params.verification?.rawResponse as
              | Prisma.InputJsonValue
              | undefined,
            verifiedAmount,
            verifiedReceiverName:
              params.verifiedReceiverName ?? params.verification?.receiverName,
            verifiedData: params.verifiedData,
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
            ...(typeof existingDeposit.verifiedData === 'object' &&
            existingDeposit.verifiedData !== null &&
            !Array.isArray(existingDeposit.verifiedData)
              ? existingDeposit.verifiedData
              : {}),
            verificationSource,
            decision: 'APPROVED',
            approvedByAdmin: true,
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
    if (verification.errorCode === 'VERIFICATION_PENDING') {
      return {
        status: DepositStatus.REJECTED,
        errorCode: 'VERIFICATION_PENDING',
        rejectionReason: DEPOSIT_ERROR_MESSAGES.VERIFICATION_PENDING,
      };
    }

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
        errorCode: verification.errorCode ?? 'INVALID_TRANSACTION',
        rejectionReason:
          verification.reason ?? DEPOSIT_ERROR_MESSAGES.INVALID_TRANSACTION,
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
        errorCode: 'INVALID_TRANSACTION',
        rejectionReason: DEPOSIT_ERROR_MESSAGES.INVALID_TRANSACTION,
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
        errorCode: 'INVALID_TRANSACTION',
        rejectionReason: DEPOSIT_ERROR_MESSAGES.INVALID_TRANSACTION,
      };
    }

    return { status: DepositStatus.APPROVED };
  }

  private async ensureReferenceAvailable(
    provider: PaymentProvider,
    transactionRef: string,
    userId?: string,
  ) {
    const existing = await this.findActiveDepositByReference(
      provider,
      transactionRef,
    );
    if (!existing) {
      return null;
    }

    if (userId && existing.userId === userId) {
      return existing;
    }

    if (existing.status === DepositStatus.PENDING) {
      throw this.buildDepositException('UNDER_REVIEW');
    }

    throw this.buildDepositException('ALREADY_USED');
  }

  private async findActiveDepositByReference(
    provider: PaymentProvider,
    transactionRef: string,
  ) {
    return this.prisma.deposit.findFirst({
      where: {
        provider,
        transactionRef,
        status: {
          in: [DepositStatus.PENDING, DepositStatus.APPROVED],
        },
      },
      select: adminDepositSelect,
    });
  }

  private buildDepositException(code: DepositErrorCode, message?: string) {
    const resolvedMessage = message ?? DEPOSIT_ERROR_MESSAGES[code];
    if (code === 'ALREADY_USED' || code === 'UNDER_REVIEW') {
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

  private assertDepositApprovalPin(approvalPin: string): void {
    if (approvalPin !== DEPOSIT_MANUAL_APPROVAL_PIN) {
      throw new BadRequestException({
        message: 'Invalid approval PIN.',
        code: 'INVALID_APPROVAL_PIN',
      });
    }
  }

  private emitDepositUpdated(deposit: {
    id: string;
    userId: string;
    provider: PaymentProvider;
    amount: Prisma.Decimal;
    transactionRef: string;
    status: DepositStatus;
    rejectionReason: string | null;
    verifiedAt: Date | null;
    updatedAt: Date;
  }): void {
    const payload = {
      id: deposit.id,
      provider: deposit.provider,
      amount: deposit.amount.toString(),
      transactionRef: deposit.transactionRef,
      status: deposit.status,
      rejectionReason: deposit.rejectionReason,
      verifiedAt: deposit.verifiedAt?.toISOString() ?? null,
      updatedAt: deposit.updatedAt.toISOString(),
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
        title: pushNotificationMessages.depositApproved.title,
        body: pushNotificationMessages.depositApproved.body(amount.toString()),
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

  private async emitDepositRejectedPush(
    userId: string,
    depositId: string,
    amount: Prisma.Decimal,
    rejectionReason: string | null,
  ) {
    try {
      await this.notificationsService.sendAppNotificationToUser(userId, {
        category: 'DEPOSIT_REJECTED',
        title: pushNotificationMessages.depositRejected.title,
        body: pushNotificationMessages.depositRejected.body(
          amount.toString(),
          rejectionReason,
        ),
        route: '/wallet/deposit',
        entityId: depositId,
        data: {
          depositId,
          amount: amount.toString(),
          ...(rejectionReason?.trim()
            ? { rejectionReason: rejectionReason.trim() }
            : {}),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send DEPOSIT_REJECTED push for deposit ${depositId}: ${
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

    if (decimalAmount.lt(10)) {
      throw new BadRequestException('Minimum deposit is 10 ETB');
    }

    if (decimalAmount.gt(10000)) {
      throw new BadRequestException('Maximum deposit is 10000 ETB');
    }

    return decimalAmount;
  }

  private normalizeTransactionRef(
    transactionRef: string,
    provider: PaymentProvider,
    approvalMode: DepositApprovalMode,
  ): string {
    const normalized = canonicalizeDepositTransactionRef({
      provider,
      approvalMode,
      transactionRef,
      cbeReceiptBaseUrl: this.getCbeReceiptBaseUrl(),
    });
    if (!normalized) {
      throw new BadRequestException(
        provider === PaymentProvider.CBE &&
          approvalMode === DepositApprovalMode.MANUAL
          ? 'Enter a valid CBE receipt ID or official receipt URL.'
          : 'transactionRef must be 6 to 120 alphanumeric characters',
      );
    }
    return normalized;
  }

  private ensureTransactionRefFormat(transactionRef: string): void {
    if (!/^[A-Z0-9-]{6,120}$/i.test(transactionRef)) {
      throw new BadRequestException(
        'transactionRef must be 6 to 120 alphanumeric characters',
      );
    }
  }

  private getCbeReceiptBaseUrl(): string {
    return (
      this.configService.get<string>('CBE_RECEIPT_BASE_URL') ??
      'https://mbreciept.cbe.com.et/receipt'
    );
  }

  private normalizeDigits(value: string): string {
    return value.replace(/\D/g, '');
  }

  private getTelebirrAccounts(): Array<{
    settlementAccount: string;
    receiverName: string;
    receiverPhoneLast4: string;
  }> {
    const primaryPhone =
      this.configService.get<string>('TELEBIRR_RECEIVER_PHONE') ?? '';
    const primary = {
      settlementAccount:
        this.configService.get<string>('TELEBIRR_SETTLEMENT_ACCOUNT') ??
        primaryPhone,
      receiverName:
        this.configService.get<string>('TELEBIRR_RECEIVER_NAME') ?? '',
      receiverPhoneLast4:
        this.configService.get<string>('TELEBIRR_RECEIVER_PHONE_LAST4') ??
        this.normalizeDigits(primaryPhone).slice(-4),
    };

    const secondarySettlement = this.configService
      .get<string>('TELEBIRR_SETTLEMENT_ACCOUNT_2')
      ?.trim();
    if (!secondarySettlement) {
      return [primary];
    }

    const secondaryPhone =
      this.configService.get<string>('TELEBIRR_RECEIVER_PHONE_2') ??
      secondarySettlement;
    const secondary = {
      settlementAccount: secondarySettlement,
      receiverName:
        this.configService.get<string>('TELEBIRR_RECEIVER_NAME_2') ?? '',
      receiverPhoneLast4:
        this.configService.get<string>('TELEBIRR_RECEIVER_PHONE_LAST4_2') ??
        this.normalizeDigits(secondaryPhone).slice(-4),
    };

    return [primary, secondary];
  }
}
