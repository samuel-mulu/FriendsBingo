import { BadRequestException, ConflictException } from '@nestjs/common';
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
      receiptUrl: null,
      walletTransactionId: null,
      status: DepositStatus.APPROVED,
      verifiedData: null,
      rejectionReason: null,
      verifyEtRequestId: 'req-1',
      verifyEtRawResponse: { source: 'verify.et' },
      verifiedAmount: new Prisma.Decimal('100'),
      verifiedReceiverName: 'Friends Bingo',
      createdAt: new Date('2026-06-02T10:00:00.000Z'),
      verifiedAt,
      updatedAt: new Date('2026-06-02T11:00:00.000Z'),
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
    existingDeposit?: Record<string, unknown> | null;
    createThrowsP2002?: boolean;
  }) {
    const approvedDeposit = createAdminDeposit();

    const tx = {
      deposit: {
        create: overrides?.createThrowsP2002
          ? jest.fn().mockRejectedValue(
              new Prisma.PrismaClientKnownRequestError('duplicate', {
                code: 'P2002',
                clientVersion: 'test',
              }),
            )
          : jest.fn().mockResolvedValue(approvedDeposit),
        findUnique: jest.fn().mockResolvedValue({
          ...approvedDeposit,
          walletTransactionId: 'wallet-tx-1',
        }),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          ...approvedDeposit,
          ...data,
        })),
      },
    };

    const prisma = {
      deposit: {
        create: tx.deposit.create,
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve(overrides?.existingDeposit ?? null),
        ),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
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
      }),
    };

    const verifyEtService = {
      verifyDeposit: jest.fn().mockResolvedValue(
        overrides?.verificationResult ?? {
          verified: true,
          amount: '100',
          receiverName: 'Friends Bingo',
          settlementMatched: true,
          rawResponse: { source: 'verify.et' },
          requestId: 'req-1',
        },
      ),
    };

    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          TELEBIRR_PROVIDER_NAME: 'Telebirr',
          CBE_PROVIDER_NAME: 'CBE Bank',
          TELEBIRR_RECEIVER_PHONE: '0911002200',
          TELEBIRR_RECEIVER_PHONE_LAST4: '2200',
          TELEBIRR_RECEIVER_NAME: 'Friends Bingo',
          TELEBIRR_RECEIPT_BASE_URL:
            'https://transactioninfo.ethiotelecom.et/receipt',
        };
        return values[key];
      }),
    };

    const service = new DepositsService(
      prisma as never,
      walletService as never,
      verifyEtService as never,
      configService as never,
      { emitToUser: jest.fn(), emitToAdmin: jest.fn() } as never,
      { create: jest.fn() } as never,
    );

    return {
      service,
      prisma,
      walletService,
      verifyEtService,
    };
  }

  it('saves only approved CBE deposits when Verify.ET confirms settlement and amount', async () => {
    const { service, walletService, prisma } = createService();

    const result = await service.createDeposit('user-1', {
      provider: PaymentProvider.CBE,
      amount: '100',
      transactionRef: 'FT26152ZN0XY',
    });

    expect(result.status).toBe(DepositStatus.APPROVED);
    expect(walletService.creditWallet).toHaveBeenCalledTimes(1);
    expect(prisma.deposit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: DepositStatus.APPROVED,
        }),
      }),
    );
  });

  it('rejects duplicate approved references before Verify.ET', async () => {
    const { service, verifyEtService } = createService({
      existingDeposit: {
        id: 'deposit-existing',
        status: DepositStatus.APPROVED,
      },
    });

    await expect(
      service.createDeposit('user-1', {
        provider: PaymentProvider.CBE,
        amount: '100',
        transactionRef: 'FT26152ZN0XY',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(verifyEtService.verifyDeposit).not.toHaveBeenCalled();
  });

  it('does not save amount mismatch failures', async () => {
    const { service, walletService, prisma } = createService({
      verificationResult: {
        verified: true,
        amount: '90',
        settlementMatched: true,
        rawResponse: {},
        requestId: 'req-1',
      },
    });

    await expect(
      service.createDeposit('user-1', {
        provider: PaymentProvider.CBE,
        amount: '100',
        transactionRef: 'FT26152ZN0XY',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(walletService.creditWallet).not.toHaveBeenCalled();
    expect(prisma.deposit.create).not.toHaveBeenCalled();
  });

  it('does not save settlement mismatch failures', async () => {
    const { service, walletService, prisma } = createService({
      verificationResult: {
        verified: true,
        amount: '100',
        settlementMatched: false,
        rawResponse: {},
        requestId: 'req-1',
        errorCode: 'SETTLEMENT_MISMATCH',
      },
    });

    await expect(
      service.createDeposit('user-1', {
        provider: PaymentProvider.AWASH,
        amount: '100',
        transactionRef: 'AW12345678',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(walletService.creditWallet).not.toHaveBeenCalled();
    expect(prisma.deposit.create).not.toHaveBeenCalled();
  });

  it('check-ref returns ALREADY_USED only for approved deposits', async () => {
    const { service } = createService({
      existingDeposit: {
        id: 'deposit-existing',
        status: DepositStatus.APPROVED,
      },
    });

    const result = await service.checkDepositReference('user-1', {
      provider: PaymentProvider.BOA,
      transactionRef: 'BOA123456',
    });

    expect(result.code).toBe('ALREADY_USED');
  });

  it('check-ref returns OK when only rejected legacy rows exist', async () => {
    const { service } = createService({
      existingDeposit: null,
    });

    const result = await service.checkDepositReference('user-1', {
      provider: PaymentProvider.TELEBIRR,
      transactionRef: 'DFF3WLQB6R',
    });

    expect(result.code).toBe('OK');
  });
});
