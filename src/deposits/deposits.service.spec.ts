import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { DepositStatus, PaymentProvider, Prisma } from '@prisma/client';
import { DepositVerificationLockService } from './deposit-verification-lock.service';
import { TelebirrReceiptParseStatus } from './dto/telebirr-receipt-parse-status.enum';
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
    approvedDuplicateExistsInTx?: boolean;
    createdDeposit?: Record<string, unknown>;
    approvedTelebirrExists?: boolean;
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
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve(
            overrides?.approvedDuplicateExistsInTx
              ? { id: 'deposit-approved-in-tx' }
              : overrides?.approvedDuplicateExists ||
                  overrides?.approvedTelebirrExists
                ? { id: 'deposit-approved' }
                : null,
          ),
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
      CBE_RECEIPT_BASE_URL: 'https://mbreciept.cbe.com.et/receipt',
      TELEBIRR_RECEIVER_PHONE: '0962520885',
      TELEBIRR_RECEIVER_PHONE_LAST4: '0885',
      TELEBIRR_RECEIVER_NAME: 'Friends Bingo',
      TELEBIRR_SETTLEMENT_ACCOUNT: '0962520885',
      VERIFY_ET_API_KEY: 'verify-et-test-key',
      VERIFY_ET_BASE_URL: 'https://verify.et',
      VERIFY_ET_WAIT_MS: '5000',
      VERIFY_ET_POLL_ATTEMPTS: '10',
      VERIFY_ET_POLL_INTERVAL_MS: '1500',
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

    const depositVerificationLockService = new DepositVerificationLockService();

    return {
      service: new DepositsService(
        prisma as never,
        walletService as never,
        paymentVerificationService as never,
        configService as never,
        realtimeService as never,
        auditLogService as never,
        depositVerificationLockService as never,
      ),
      prisma,
      tx,
      walletService,
      paymentVerificationService,
      realtimeService,
      auditLogService,
      depositVerificationLockService,
    };
  }

  function validTelebirrClientReceipt(
    transactionRef = 'DFE8V9NO7E',
    settledAmount = '100',
  ) {
    return {
      invoiceNumber: transactionRef,
      transactionStatus: 'Completed',
      settledAmount,
      creditedPartyName: 'Friends Bingo',
      creditedPartyAccountNo: '2519****0885',
    };
  }

  describe('Telebirr verify-first flow', () => {
    it('returns AMOUNT_MISMATCH from check-ref when parsed client receipt mismatches amount', async () => {
      const { service } = createService();

      await expect(
        service.checkDepositReference({
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFF3WLQB6R',
          amount: '31',
          receiptParseStatus: TelebirrReceiptParseStatus.PARSED,
          clientReceipt: validTelebirrClientReceipt('DFF3WLQB6R', '30.00'),
        }),
      ).resolves.toEqual({
        code: 'AMOUNT_MISMATCH',
        message: TELEBIRR_AMOUNT_MISMATCH_MESSAGE,
      });
    });

    it('rejects parsed client gate amount mismatch without calling Verify.ET', async () => {
      const { service, paymentVerificationService, tx } = createService();

      await expect(
        service.createDeposit('user-1', {
          provider: PaymentProvider.TELEBIRR,
          amount: '50',
          transactionRef: 'DFE8V9NO7E',
          receiptParseStatus: TelebirrReceiptParseStatus.PARSED,
          clientReceipt: validTelebirrClientReceipt('DFE8V9NO7E', '100'),
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'AMOUNT_MISMATCH',
          message: TELEBIRR_AMOUNT_MISMATCH_MESSAGE,
        }),
      });

      expect(paymentVerificationService.verifyDeposit).not.toHaveBeenCalled();
      expect(tx.deposit.create).not.toHaveBeenCalled();
    });

    it('rejects parsed client gate receiver mismatch without calling Verify.ET', async () => {
      const { service, paymentVerificationService, tx } = createService();

      await expect(
        service.createDeposit('user-1', {
          provider: PaymentProvider.TELEBIRR,
          amount: '100',
          transactionRef: 'DFE8V9NO7E',
          receiptParseStatus: TelebirrReceiptParseStatus.PARSED,
          clientReceipt: {
            ...validTelebirrClientReceipt('DFE8V9NO7E', '100'),
            creditedPartyAccountNo: '2519****9999',
          },
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'RECEIVER_MISMATCH',
          message: TELEBIRR_RECEIVER_MISMATCH_MESSAGE,
        }),
      });

      expect(paymentVerificationService.verifyDeposit).not.toHaveBeenCalled();
      expect(tx.deposit.create).not.toHaveBeenCalled();
    });

    it('calls Verify.ET when parsed client gate passes', async () => {
      const { service, paymentVerificationService } = createService({
        createdDeposit: createAdminDeposit({
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          status: DepositStatus.APPROVED,
          verifiedAt,
        }),
        verificationResult: {
          verified: true,
          status: 'VERIFIED',
          code: 'APPROVED',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          amount: '100',
          currency: 'ETB',
          receiverAccount: '0962520885',
          receiverName: 'Friends Bingo',
          verificationSource: 'verify.et',
        },
      });

      await service.createDeposit('user-1', {
        provider: PaymentProvider.TELEBIRR,
        amount: '100',
        transactionRef: 'DFE8V9NO7E',
        receiptParseStatus: TelebirrReceiptParseStatus.PARSED,
        clientReceipt: validTelebirrClientReceipt('DFE8V9NO7E', '100'),
      });

      expect(paymentVerificationService.verifyDeposit).toHaveBeenCalledTimes(1);
    });

    it('calls Verify.ET fallback when client parse status is unavailable', async () => {
      const { service, paymentVerificationService } = createService({
        createdDeposit: createAdminDeposit({
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          status: DepositStatus.APPROVED,
          verifiedAt,
        }),
        verificationResult: {
          verified: true,
          status: 'VERIFIED',
          code: 'APPROVED',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          amount: '100',
          currency: 'ETB',
          receiverAccount: '0962520885',
          receiverName: 'Friends Bingo',
          verificationSource: 'verify.et',
        },
      });

      await service.createDeposit('user-1', {
        provider: PaymentProvider.TELEBIRR,
        amount: '100',
        transactionRef: 'DFE8V9NO7E',
        receiptParseStatus: TelebirrReceiptParseStatus.UNAVAILABLE,
      });

      expect(paymentVerificationService.verifyDeposit).toHaveBeenCalledTimes(1);
    });

    it('returns CAN_VERIFY for an unused Telebirr reference', async () => {
      const { service } = createService();

      await expect(
        service.checkDepositReference({
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFF3WLQB6R',
        }),
      ).resolves.toEqual({
        code: 'CAN_VERIFY',
        message: 'Receipt is available for verification.',
      });
    });

    it('returns ALREADY_USED for an approved Telebirr reference', async () => {
      const { service } = createService({
        approvedTelebirrExists: true,
      });

      await expect(
        service.checkDepositReference({
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFF3WLQB6R',
        }),
      ).resolves.toEqual({
        code: 'ALREADY_USED',
        message: TELEBIRR_DUPLICATE_MESSAGE,
      });
    });

    it('blocks invalid references before calling Verify.ET', async () => {
      const { service, paymentVerificationService } = createService();

      await expect(
        service.createDeposit('user-1', {
          provider: PaymentProvider.TELEBIRR,
          amount: '100',
          transactionRef: 'bad ref',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(paymentVerificationService.verifyDeposit).not.toHaveBeenCalled();
    });

    it('returns duplicate message for already approved receipts without calling Verify.ET', async () => {
      const { service, tx, paymentVerificationService } = createService({
        approvedTelebirrExists: true,
      });

      await expect(
        service.createDeposit('user-1', {
          provider: PaymentProvider.TELEBIRR,
          amount: '100',
          transactionRef: 'DFE8V9NO7E',
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ALREADY_USED',
          message: TELEBIRR_DUPLICATE_MESSAGE,
        }),
      });

      expect(paymentVerificationService.verifyDeposit).not.toHaveBeenCalled();
      expect(tx.deposit.create).not.toHaveBeenCalled();
    });

    it('creates an APPROVED deposit and credits wallet when Verify.ET returns a completed verification', async () => {
      const { service, prisma, tx, walletService } = createService({
        createdDeposit: createAdminDeposit({
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          status: DepositStatus.APPROVED,
          verifiedAt,
        }),
        verificationResult: {
          verified: true,
          status: 'VERIFIED',
          code: 'APPROVED',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          amount: '100',
          currency: 'ETB',
          receiverAccount: '0962520885',
          receiverName: 'Friends Bingo',
          verificationSource: 'verify.et',
          requestId: 'verify-et-req-1',
          raw: {
            source: 'verify.et',
            requestId: 'verify-et-req-1',
            finalResponse: {
              processingStatus: 'completed',
            },
          },
        },
      });

      const result = await service.createDeposit('user-1', {
        provider: PaymentProvider.TELEBIRR,
        amount: '100',
        transactionRef: 'dfe8v9no7e',
      });

      expect(tx.deposit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            transactionRef: 'DFE8V9NO7E',
            status: DepositStatus.APPROVED,
            receiptUrl: null,
          }),
        }),
      );
      expect(walletService.creditWallet).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(DepositStatus.APPROVED);
    });

    it('creates an APPROVED deposit and credits wallet when Verify.ET completes after polling', async () => {
      const { service, walletService } = createService({
        createdDeposit: createAdminDeposit({
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFF3WLQB6R',
          amount: new Prisma.Decimal('100'),
          status: DepositStatus.APPROVED,
          verifiedAt,
        }),
        verificationResult: {
          verified: true,
          status: 'VERIFIED',
          code: 'APPROVED',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFF3WLQB6R',
          amount: '100.00',
          currency: 'ETB',
          receiverAccount: '0962520885',
          receiverName: 'Friends Bingo',
          verificationSource: 'verify.et',
          requestId: 'verify-et-req-queued',
          raw: {
            source: 'verify.et',
            requestId: 'verify-et-req-queued',
            submitResponse: { processingStatus: 'queued' },
            finalResponse: { processingStatus: 'completed' },
          },
        },
      });

      const result = await service.createDeposit('user-1', {
        provider: PaymentProvider.TELEBIRR,
        amount: '100',
        transactionRef: 'DFF3WLQB6R',
      });

      expect(walletService.creditWallet).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(DepositStatus.APPROVED);
    });

    it('does not create a deposit row when amount mismatches', async () => {
      const { service, prisma, tx } = createService({
        verificationResult: {
          verified: false,
          status: 'INVALID',
          code: 'AMOUNT_MISMATCH',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          amount: '100',
          currency: 'ETB',
          receiverAccount: '0962520885',
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
        response: expect.objectContaining({
          code: 'AMOUNT_MISMATCH',
          message: TELEBIRR_AMOUNT_MISMATCH_MESSAGE,
        }),
      });

      expect(prisma.deposit.create).not.toHaveBeenCalled();
      expect(tx.deposit.create).not.toHaveBeenCalled();
    });

    it('does not create a deposit row when receiver mismatches', async () => {
      const { service, tx } = createService({
        verificationResult: {
          verified: false,
          status: 'INVALID',
          code: 'RECEIVER_MISMATCH',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          amount: '100',
          currency: 'ETB',
          receiverAccount: '0962520999',
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
        response: expect.objectContaining({
          code: 'RECEIVER_MISMATCH',
          message: TELEBIRR_RECEIVER_MISMATCH_MESSAGE,
        }),
      });

      expect(tx.deposit.create).not.toHaveBeenCalled();
    });

    it('does not create a deposit row for invalid receipts', async () => {
      const { service, tx } = createService({
        verificationResult: {
          verified: false,
          status: 'INVALID',
          code: 'INVALID_RECEIPT',
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
        response: expect.objectContaining({
          code: 'INVALID_RECEIPT',
          message: TELEBIRR_INVALID_RECEIPT_MESSAGE,
        }),
      });

      expect(tx.deposit.create).not.toHaveBeenCalled();
    });

    it('does not create a deposit row when Verify.ET is unavailable', async () => {
      const { service, tx } = createService({
        verificationResult: {
          verified: false,
          status: 'ERROR',
          code: 'VERIFICATION_UNAVAILABLE',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
        },
      });

      await expect(
        service.createDeposit('user-1', {
          provider: PaymentProvider.TELEBIRR,
          amount: '100',
          transactionRef: 'DFE8V9NO7E',
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'VERIFICATION_UNAVAILABLE',
        }),
      });

      expect(tx.deposit.create).not.toHaveBeenCalled();
    });

    it('prevents duplicate verification calls while a lock is active', async () => {
      const { service, paymentVerificationService } = createService({
        createdDeposit: createAdminDeposit({
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          status: DepositStatus.APPROVED,
          verifiedAt,
        }),
      });
      let resolveVerification: ((value: Record<string, unknown>) => void) | null =
        null;
      paymentVerificationService.verifyDeposit.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveVerification = resolve;
        }),
      );

      const firstRequest = service.createDeposit('user-1', {
        provider: PaymentProvider.TELEBIRR,
        amount: '100',
        transactionRef: 'DFE8V9NO7E',
      });

      await expect(
        service.createDeposit('user-1', {
          provider: PaymentProvider.TELEBIRR,
          amount: '100',
          transactionRef: 'DFE8V9NO7E',
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'VERIFY_IN_PROGRESS',
        }),
      });

      expect(paymentVerificationService.verifyDeposit).toHaveBeenCalledTimes(1);

      resolveVerification?.({
        verified: true,
        status: 'VERIFIED',
        code: 'APPROVED',
        provider: PaymentProvider.TELEBIRR,
        transactionRef: 'DFE8V9NO7E',
        amount: '100',
        currency: 'ETB',
        receiverAccount: '0962520885',
        receiverName: 'Friends Bingo',
        verificationSource: 'verify.et',
        requestId: 'verify-et-req-lock',
      });

      await expect(firstRequest).resolves.toMatchObject({
        status: DepositStatus.APPROVED,
      });
    });

    it('blocks approval if another approved receipt appears inside the transaction', async () => {
      const { service, tx, walletService } = createService({
        approvedDuplicateExistsInTx: true,
        verificationResult: {
          verified: true,
          status: 'VERIFIED',
          code: 'APPROVED',
          provider: PaymentProvider.TELEBIRR,
          transactionRef: 'DFE8V9NO7E',
          amount: '100',
          currency: 'ETB',
          receiverAccount: '0962520885',
          receiverName: 'Friends Bingo',
          verificationSource: 'verify.et',
          requestId: 'verify-et-req-race',
        },
      });

      await expect(
        service.createDeposit('user-1', {
          provider: PaymentProvider.TELEBIRR,
          amount: '100',
          transactionRef: 'DFE8V9NO7E',
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ALREADY_USED',
        }),
      });

      expect(tx.deposit.create).not.toHaveBeenCalled();
      expect(walletService.creditWallet).not.toHaveBeenCalled();
    });
  });

  describe('CBE legacy flow', () => {
    it('returns CBE config with receipt base url and receiver last4', () => {
      const { service } = createService();

      expect(service.getDepositConfig()).toMatchObject({
        cbe: {
          providerName: 'CBE Bank',
          receiptBaseUrl: 'https://mbreciept.cbe.com.et/receipt',
          receiverAccountLast4: '5006',
          receiverName: 'Friends Bingo',
        },
      });
    });

    it('returns CAN_VERIFY for an unused CBE reference', async () => {
      const { service } = createService();

      await expect(
        service.checkDepositReference({
          provider: PaymentProvider.CBE,
          transactionRef: 'FT26152ZN0XY',
        }),
      ).resolves.toEqual({
        code: 'CAN_VERIFY',
        message: 'Receipt is available for verification.',
      });
    });

    it('returns ALREADY_USED for an approved CBE reference', async () => {
      const { service } = createService({
        approvedDuplicateExists: true,
      });

      await expect(
        service.checkDepositReference({
          provider: PaymentProvider.CBE,
          transactionRef: 'FT26152ZN0XY',
        }),
      ).resolves.toEqual({
        code: 'ALREADY_USED',
        message: TELEBIRR_DUPLICATE_MESSAGE,
      });
    });

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
        { tryAcquire: jest.fn() } as never,
      );

      await expect(
        service.retryVerification('user-1', 'deposit-1'),
      ).rejects.toBeInstanceOf(HttpException);
    });
  });
});
