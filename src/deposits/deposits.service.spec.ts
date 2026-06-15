import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { DepositStatus, PaymentProvider, Prisma } from '@prisma/client';
import { DepositsService } from './deposits.service';
import {
  TELEBIRR_AMOUNT_MISMATCH_MESSAGE,
  TELEBIRR_DUPLICATE_MESSAGE,
  TELEBIRR_INVALID_RECEIPT_MESSAGE,
  TELEBIRR_RECEIVER_MISMATCH_MESSAGE,
} from './telebirr-deposit.messages';

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
      receiptUrl: null,
      walletTransactionId: null,
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
    approvedTelebirrExists?: boolean;
    legacyRejectedTelebirrExists?: boolean;
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
        findFirst: jest.fn().mockResolvedValue(
          overrides?.approvedDuplicateExists || overrides?.approvedTelebirrExists
            ? { id: 'deposit-approved' }
            : null,
        ),
        create: jest.fn().mockResolvedValue({
          ...createdDeposit,
          status: DepositStatus.APPROVED,
          verifiedAt,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          ...createdDeposit,
          ...data,
        })),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const prisma = {
      deposit: {
        create: jest.fn().mockResolvedValue(createdDeposit),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where?.id) {
            return Promise.resolve(createdDeposit);
          }

          return Promise.resolve(null);
        }),
        findFirst: jest.fn().mockImplementation(({ where }) => {
          if (
            where?.status === DepositStatus.APPROVED &&
            (overrides?.approvedDuplicateExists ||
              overrides?.approvedTelebirrExists)
          ) {
            return Promise.resolve({ id: 'deposit-approved' });
          }

          return Promise.resolve(null);
        }),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          ...createdDeposit,
          ...data,
        })),
        deleteMany: jest.fn().mockResolvedValue({
          count: overrides?.legacyRejectedTelebirrExists ? 1 : 0,
        }),
      },
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const walletService = {
      creditWallet: jest.fn().mockResolvedValue('wallet-tx-1'),
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
      TELEBIRR_RECEIVER_PHONE: '0962520885',
      TELEBIRR_RECEIVER_PHONE_LAST4: '0885',
      TELEBIRR_RECEIVER_NAME: 'Friends Bingo',
      TELEBIRR_RECEIPT_BASE_URL: 'https://transactioninfo.ethiotelecom.et/receipt',
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

  describe('Telebirr verify-first flow', () => {
    it('creates an APPROVED deposit and credits wallet when verification passes', async () => {
      const { service, prisma, tx, walletService } = createService({
        createdDeposit: createAdminDeposit({
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          receiptUrl:
            'https://transactioninfo.ethiotelecom.et/receipt/DFE8V9NO7E',
          status: DepositStatus.APPROVED,
          verifiedAt,
        }),
        verificationResult: {
          verified: true,
          status: 'VERIFIED',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          amount: '100',
          currency: 'ETB',
          receiverAccount: '2519****0885',
          receiverName: 'Friends Bingo',
        },
      });

      const result = await service.createDeposit('user-1', {
        provider: PaymentProvider.TELEBIRR,
        amount: '100',
        transactionRef: 'dfe8v9no7e',
      });

      expect(prisma.deposit.deleteMany).toHaveBeenCalled();
      expect(tx.deposit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            transactionRef: 'DFE8V9NO7E',
            status: DepositStatus.APPROVED,
            receiptUrl:
              'https://transactioninfo.ethiotelecom.et/receipt/DFE8V9NO7E',
          }),
        }),
      );
      expect(walletService.creditWallet).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(DepositStatus.APPROVED);
    });

    it('does not create a deposit row when total paid amount is submitted instead of settled amount', async () => {
      const { service, tx } = createService({
        verificationResult: {
          verified: true,
          status: 'VERIFIED',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFF3WLQB6R',
          amount: '30.00',
          currency: 'ETB',
          receiverAccount: '2519****0885',
          receiverName: 'Samueal Mulu Gebremedhin',
        },
      });

      await expect(
        service.createDeposit('user-1', {
          provider: PaymentProvider.TELEBIRR,
          amount: '31',
          transactionRef: 'DFF3WLQB6R',
        }),
      ).rejects.toMatchObject({
        message: TELEBIRR_AMOUNT_MISMATCH_MESSAGE,
      });

      expect(tx.deposit.create).not.toHaveBeenCalled();
    });

    it('approves when submitted amount matches settled amount', async () => {
      const { service, walletService } = createService({
        createdDeposit: createAdminDeposit({
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFF3WLQB6R',
          amount: new Prisma.Decimal('30'),
          status: DepositStatus.APPROVED,
          verifiedAt,
        }),
        verificationResult: {
          verified: true,
          status: 'VERIFIED',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFF3WLQB6R',
          amount: '30.00',
          currency: 'ETB',
          receiverAccount: '2519****0885',
          receiverName: 'Friends Bingo',
        },
      });

      const result = await service.createDeposit('user-1', {
        provider: PaymentProvider.TELEBIRR,
        amount: '30',
        transactionRef: 'DFF3WLQB6R',
      });

      expect(walletService.creditWallet).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(DepositStatus.APPROVED);
    });

    it('does not create a deposit row when amount mismatches', async () => {
      const { service, prisma, tx } = createService({
        verificationResult: {
          verified: true,
          status: 'VERIFIED',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          amount: '100',
          currency: 'ETB',
          receiverAccount: '2519****0885',
          receiverName: 'Friends Bingo',
        },
      });

      await expect(
        service.createDeposit('user-1', {
          provider: PaymentProvider.TELEBIRR,
          amount: '50',
          transactionRef: 'DFE8V9NO7E',
        }),
      ).rejects.toMatchObject({
        message: TELEBIRR_AMOUNT_MISMATCH_MESSAGE,
      });

      expect(prisma.deposit.create).not.toHaveBeenCalled();
      expect(tx.deposit.create).not.toHaveBeenCalled();
    });

    it('allows retry with correct amount after amount mismatch without a saved row', async () => {
      const { service, paymentVerificationService, walletService } =
        createService({
          createdDeposit: createAdminDeposit({
            provider: PaymentProvider.TELEBIRR,
            transactionRef: 'DFE8V9NO7E',
            status: DepositStatus.APPROVED,
            verifiedAt,
          }),
          verificationResult: {
            verified: true,
            status: 'VERIFIED',
            provider: PaymentProvider.TELEBIRR,
            transactionRef: 'DFE8V9NO7E',
            amount: '100',
            currency: 'ETB',
            receiverAccount: '2519****0885',
            receiverName: 'Friends Bingo',
          },
        });

      paymentVerificationService.verifyDeposit
        .mockResolvedValueOnce({
          verified: true,
          status: 'VERIFIED',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          amount: '100',
          currency: 'ETB',
          receiverAccount: '2519****0885',
          receiverName: 'Friends Bingo',
        })
        .mockResolvedValueOnce({
          verified: true,
          status: 'VERIFIED',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          amount: '100',
          currency: 'ETB',
          receiverAccount: '2519****0885',
          receiverName: 'Friends Bingo',
        });

      await expect(
        service.createDeposit('user-1', {
          provider: PaymentProvider.TELEBIRR,
          amount: '50',
          transactionRef: 'DFE8V9NO7E',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      const result = await service.createDeposit('user-1', {
        provider: PaymentProvider.TELEBIRR,
        amount: '100',
        transactionRef: 'DFE8V9NO7E',
      });

      expect(walletService.creditWallet).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(DepositStatus.APPROVED);
    });

    it('does not create a deposit row when receiver mismatches', async () => {
      const { service, tx } = createService({
        verificationResult: {
          verified: true,
          status: 'VERIFIED',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          amount: '100',
          currency: 'ETB',
          receiverAccount: '2519****9999',
          receiverName: 'Wrong Receiver',
        },
      });

      await expect(
        service.createDeposit('user-1', {
          provider: PaymentProvider.TELEBIRR,
          amount: '100',
          transactionRef: 'DFE8V9NO7E',
        }),
      ).rejects.toMatchObject({
        message: TELEBIRR_RECEIVER_MISMATCH_MESSAGE,
      });

      expect(tx.deposit.create).not.toHaveBeenCalled();
    });

    it('does not create a deposit row for invalid receipts', async () => {
      const { service, tx } = createService({
        verificationResult: {
          verified: false,
          status: 'INVALID',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          reason: 'Receipt could not be verified',
        },
      });

      await expect(
        service.createDeposit('user-1', {
          provider: PaymentProvider.TELEBIRR,
          amount: '100',
          transactionRef: 'DFE8V9NO7E',
        }),
      ).rejects.toMatchObject({
        message: TELEBIRR_INVALID_RECEIPT_MESSAGE,
      });

      expect(tx.deposit.create).not.toHaveBeenCalled();
    });

    it('returns duplicate message for already approved receipts', async () => {
      const { service, tx } = createService({
        approvedTelebirrExists: true,
      });

      await expect(
        service.createDeposit('user-1', {
          provider: PaymentProvider.TELEBIRR,
          amount: '100',
          transactionRef: 'DFE8V9NO7E',
        }),
      ).rejects.toMatchObject({
        message: TELEBIRR_DUPLICATE_MESSAGE,
      });

      expect(tx.deposit.create).not.toHaveBeenCalled();
    });

    it('cleans up legacy rejected rows before approving', async () => {
      const { service, prisma } = createService({
        legacyRejectedTelebirrExists: true,
        createdDeposit: createAdminDeposit({
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          status: DepositStatus.APPROVED,
          verifiedAt,
        }),
        verificationResult: {
          verified: true,
          status: 'VERIFIED',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          amount: '100',
          currency: 'ETB',
          receiverAccount: '2519****0885',
          receiverName: 'Friends Bingo',
        },
      });

      await service.createDeposit('user-1', {
        provider: PaymentProvider.TELEBIRR,
        amount: '100',
        transactionRef: 'DFE8V9NO7E',
      });

      expect(prisma.deposit.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            provider: PaymentProvider.TELEBIRR,
            transactionRef: 'DFE8V9NO7E',
          }),
        }),
      );
    });
  });

  describe('CBE legacy flow', () => {
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

    it('rejects wrong amount verification instead of manual review', async () => {
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
      expect(result.status).toBe(DepositStatus.REJECTED);
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
});
