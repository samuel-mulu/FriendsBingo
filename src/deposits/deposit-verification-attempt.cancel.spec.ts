import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DepositVerificationAttemptStatus,
  PaymentProvider,
  Prisma,
} from '@prisma/client';
import { DepositApprovalConfigService } from '../deposit-approval-config/deposit-approval-config.service';
import { TelebirrReceiptFetchService } from '../deposit-approval-config/telebirr-receipt-fetch.service';
import { AuditLogService } from '../common/services/audit-log.service';
import { UserActionRateLimitService } from '../common/rate-limit/user-action-rate-limit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { VerifyEtService } from '../verify-et/verify-et.service';
import { WalletService } from '../wallet/wallet.service';
import { ACTIVE_VERIFICATION_ATTEMPT_STATUSES } from './deposit-verification-attempt.constants';
import { DepositsService } from './deposits.service';

describe('DepositsService cancelVerificationAttempt', () => {
  const attemptId = '11111111-1111-1111-1111-111111111111';
  const userId = 'user-1';
  const transactionRef = 'DJG9V6AD9H';

  function createService(options?: {
    attempt?: Record<string, unknown> | null;
    updateManyCount?: number;
  }) {
    const attempt =
      options?.attempt === undefined
        ? {
            id: attemptId,
            userId,
            provider: PaymentProvider.TELEBIRR,
            amount: new Prisma.Decimal('10'),
            transactionRef,
            status: DepositVerificationAttemptStatus.AWAITING_PROVIDER,
            providerRequestId: 'verify-req-1',
            correlationId: 'corr-1',
            depositId: null,
            expiresAt: new Date(Date.now() + 15 * 60_000),
            lastErrorCode: 'VERIFICATION_PENDING',
            lastErrorMessage: 'pending',
          }
        : options.attempt;

    const findUnique = jest.fn(async () => attempt);
    const updateMany = jest.fn(async () => ({
      count: options?.updateManyCount ?? 1,
    }));
    const findFirst = jest.fn(async () => null);

    const prisma = {
      depositVerificationAttempt: {
        findUnique,
        updateMany,
        findFirst,
      },
      deposit: {
        findFirst: jest.fn(async () => null),
      },
    } as unknown as PrismaService;

    const service = new DepositsService(
      prisma,
      {} as WalletService,
      {} as VerifyEtService,
      {
        getMode: jest.fn(),
      } as unknown as DepositApprovalConfigService,
      {} as TelebirrReceiptFetchService,
      {
        get: jest.fn(),
      } as unknown as ConfigService,
      {} as RealtimeService,
      {} as AuditLogService,
      {} as NotificationsService,
      {
        assertWithinLimit: jest.fn(),
      } as unknown as UserActionRateLimitService,
    );

    return { service, findUnique, updateMany, findFirst, prisma };
  }

  it('expires an active attempt owned by the user', async () => {
    const { service, updateMany } = createService();

    const result = await service.cancelVerificationAttempt(userId, attemptId);

    expect(result).toEqual({
      attemptId,
      status: 'EXPIRED',
      cancelled: true,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: attemptId,
        userId,
        status: { in: ACTIVE_VERIFICATION_ATTEMPT_STATUSES },
      },
      data: {
        status: DepositVerificationAttemptStatus.EXPIRED,
        expiresAt: expect.any(Date),
        lastErrorCode: 'CANCELLED_BY_USER',
        lastErrorMessage: 'Cancelled by player',
      },
    });
  });

  it('is idempotent when attempt is already EXPIRED', async () => {
    const { service, updateMany } = createService({
      attempt: {
        id: attemptId,
        userId,
        provider: PaymentProvider.TELEBIRR,
        amount: new Prisma.Decimal('10'),
        transactionRef,
        status: DepositVerificationAttemptStatus.EXPIRED,
        providerRequestId: null,
        correlationId: 'corr-1',
      },
    });

    const result = await service.cancelVerificationAttempt(userId, attemptId);

    expect(result).toEqual({
      attemptId,
      status: 'EXPIRED',
      cancelled: true,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects cancel for a different user', async () => {
    const { service } = createService();

    await expect(
      service.cancelVerificationAttempt('other-user', attemptId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects cancel when attempt is missing', async () => {
    const { service } = createService({ attempt: null });

    await expect(
      service.cancelVerificationAttempt(userId, attemptId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not treat EXPIRED attempts as active (unlocks same ref)', () => {
    expect(ACTIVE_VERIFICATION_ATTEMPT_STATUSES).not.toContain(
      DepositVerificationAttemptStatus.EXPIRED,
    );
  });
});
