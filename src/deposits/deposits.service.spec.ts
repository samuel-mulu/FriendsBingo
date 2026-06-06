import { HttpException } from '@nestjs/common';
import { DepositStatus, PaymentProvider, Prisma } from '@prisma/client';
import { DepositsService } from './deposits.service';

describe('DepositsService', () => {
  const verifiedAt = new Date('2026-06-02T11:00:00.000Z');

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(verifiedAt);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  function createAdminDeposit(overrides?: Partial<Record<string, unknown>>) {
    return {
      id: 'deposit-1',
      userId: 'user-1',
      provider: PaymentProvider.CBE,
      amount: new Prisma.Decimal('100'),
      transactionRef: 'FT26152ZN0XY',
      status: DepositStatus.VERIFYING,
      verifiedData: null,
      rejectionReason: null,
      createdAt: new Date('2026-06-02T10:00:00.000Z'),
      verifiedAt: null,
      updatedAt: new Date('2026-06-02T10:00:00.000Z'),
      user: {
        id: 'user-1',
        fullName: 'Samuel Mulu',
        phoneNumber: '0912345678',
        role: 'PLAYER',
        status: 'ACTIVE',
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        updatedAt: new Date('2026-06-01T10:00:00.000Z'),
      },
      ...overrides,
    };
  }

  function createService(overrides?: {
    verificationResult?: Record<string, unknown>;
    approvedDuplicateExists?: boolean;
    createdDeposit?: Record<string, unknown>;
  }) {
    const createdDeposit = createAdminDeposit(overrides?.createdDeposit);

    const tx = {
      deposit: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(createdDeposit)
          .mockResolvedValueOnce({
            ...createdDeposit,
            status: DepositStatus.APPROVED,
            verifiedAt,
            verifiedData: { decision: 'APPROVED' },
          }),
        findFirst: jest
          .fn()
          .mockResolvedValue(
            overrides?.approvedDuplicateExists ? { id: 'deposit-2' } : null,
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const prisma = {
      deposit: {
        create: jest.fn().mockResolvedValue(createdDeposit),
        findUnique: jest.fn().mockResolvedValue(createdDeposit),
        findFirst: jest
          .fn()
          .mockResolvedValue(
            overrides?.approvedDuplicateExists ? { id: 'deposit-2' } : null,
          ),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          ...createdDeposit,
          ...data,
        })),
      },
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const walletService = {
      creditWallet: jest.fn().mockResolvedValue(undefined),
      getSerializedWallet: jest.fn().mockResolvedValue({
        id: 'wallet-1',
        userId: 'user-1',
        balance: '100.00',
        lockedBalance: '0.00',
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        updatedAt: verifiedAt,
      }),
    };

    const paymentVerificationService = {
      verifyDeposit: jest.fn().mockResolvedValue(
        overrides?.verificationResult ?? {
          verified: true,
          status: 'VERIFIED',
          provider: PaymentProvider.CBE,
          transactionRef: 'FT26152ZN0XY',
          amount: '100',
          currency: 'ETB',
          receiverAccount: '1002003004005006',
          receiverName: 'Friends Bingo',
          raw: { source: 'mock' },
        },
      ),
    };

    const configValues: Record<string, string> = {
      CBE_ACCOUNT_NUMBER: '1002003004005006',
      CBE_ACCOUNT_LAST8: '4005006',
      CBE_RECEIVER_NAME: 'Friends Bingo',
      TELEBIRR_RECEIVER_PHONE: '0911002200',
      TELEBIRR_RECEIVER_NAME: 'Friends Bingo',
    };

    const configService = {
      get: jest.fn((key: string) => configValues[key]),
    };

    const realtimeService = {
      emitToUser: jest.fn(),
      emitToAdmin: jest.fn(),
      emitToGame: jest.fn(),
    };

    const auditLogService = {
      create: jest.fn().mockResolvedValue(undefined),
    };

    return {
      service: new DepositsService(
        prisma as never,
        walletService as never,
        paymentVerificationService as never,
        configService as never,
        realtimeService as never,
        auditLogService as never,
      ),
      prisma,
      tx,
      walletService,
      paymentVerificationService,
      realtimeService,
      auditLogService,
    };
  }

  it('credits wallet once for a verified CBE deposit', async () => {
    const { service, walletService, paymentVerificationService } =
      createService();

    const result = await service.createDeposit('user-1', {
      provider: PaymentProvider.CBE,
      amount: '100',
      transactionRef: 'ft26152zn0xy',
    });

    expect(paymentVerificationService.verifyDeposit).toHaveBeenCalled();
    expect(walletService.creditWallet).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(DepositStatus.APPROVED);
  });

  it('moves wrong amount verification to manual review', async () => {
    const { service, walletService } = createService({
      verificationResult: {
        verified: true,
        status: 'VERIFIED',
        provider: PaymentProvider.CBE,
        transactionRef: 'FT26152ZN0XY',
        amount: '90',
        currency: 'ETB',
        receiverAccount: '1002003004005006',
        receiverName: 'Friends Bingo',
      },
    });

    const result = await service.createDeposit('user-1', {
      provider: PaymentProvider.CBE,
      amount: '100',
      transactionRef: 'FT26152ZN0XY',
    });

    expect(walletService.creditWallet).not.toHaveBeenCalled();
    expect(result.status).toBe(DepositStatus.MANUAL_REVIEW);
  });

  it('moves wrong receiver to manual review', async () => {
    const { service } = createService({
      verificationResult: {
        verified: true,
        status: 'VERIFIED',
        provider: PaymentProvider.CBE,
        transactionRef: 'FT26152ZN0XY',
        amount: '100',
        currency: 'ETB',
        receiverAccount: '9999999999999999',
        receiverName: 'Wrong Receiver',
      },
    });

    const result = await service.createDeposit('user-1', {
      provider: PaymentProvider.CBE,
      amount: '100',
      transactionRef: 'FT26152ZN0XY',
    });

    expect(result.status).toBe(DepositStatus.MANUAL_REVIEW);
  });

  it('prevents duplicate transaction references from being approved twice', async () => {
    const { service, walletService } = createService({
      approvedDuplicateExists: true,
    });

    const result = await service.createDeposit('user-1', {
      provider: PaymentProvider.CBE,
      amount: '100',
      transactionRef: 'FT26152ZN0XY',
    });

    expect(walletService.creditWallet).not.toHaveBeenCalled();
    expect(result.status).toBe(DepositStatus.REJECTED);
  });

  it('moves verifier errors to manual review', async () => {
    const { service, walletService, paymentVerificationService } =
      createService();
    paymentVerificationService.verifyDeposit.mockRejectedValueOnce(
      new Error('provider unavailable'),
    );

    const result = await service.createDeposit('user-1', {
      provider: PaymentProvider.CBE,
      amount: '100',
      transactionRef: 'FT26152ZN0XY',
    });

    expect(walletService.creditWallet).not.toHaveBeenCalled();
    expect(result.status).toBe(DepositStatus.MANUAL_REVIEW);
  });

  it('rate limits rapid retry verification calls', async () => {
    const deposit = createAdminDeposit({
      status: DepositStatus.MANUAL_REVIEW,
      updatedAt: new Date(verifiedAt.getTime() - 10_000),
    });

    const prisma = {
      deposit: {
        findFirst: jest.fn().mockResolvedValue(deposit),
      },
    };

    const service = new DepositsService(
      prisma as never,
      {} as never,
      {} as never,
      { get: jest.fn() } as never,
      {
        emitToUser: jest.fn(),
        emitToAdmin: jest.fn(),
        emitToGame: jest.fn(),
      } as never,
      { create: jest.fn() } as never,
    );

    await expect(
      service.retryVerification('user-1', 'deposit-1'),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
