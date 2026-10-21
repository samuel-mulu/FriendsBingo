import { ConflictException } from '@nestjs/common';
import { DepositApprovalMode, DepositStatus, PaymentProvider, Prisma } from '@prisma/client';
import { DepositsService } from './deposits.service';

describe('DepositsService Idempotent Processing', () => {
  let service: DepositsService;
  let prismaMock: any;
  let walletServiceMock: any;
  let verifyEtServiceMock: any;
  let depositApprovalConfigServiceMock: any;
  let configServiceMock: any;
  let realtimeServiceMock: any;
  let auditLogServiceMock: any;

  beforeEach(() => {
    prismaMock = {
      deposit: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    walletServiceMock = {
      creditWallet: jest.fn(),
    };
    verifyEtServiceMock = {
      verifyDeposit: jest.fn(),
    };
    depositApprovalConfigServiceMock = {
      getMode: jest.fn().mockResolvedValue(DepositApprovalMode.AUTOMATIC),
      getPlayerProviderConfigs: jest.fn().mockResolvedValue([]),
    };
    configServiceMock = {
      get: jest.fn().mockReturnValue('dummy'),
    };
    realtimeServiceMock = {
      emitToUser: jest.fn(),
      emitToAdmin: jest.fn(),
    };
    auditLogServiceMock = {
      create: jest.fn().mockResolvedValue(undefined),
    };

    service = new DepositsService(
      prismaMock,
      walletServiceMock,
      verifyEtServiceMock,
      depositApprovalConfigServiceMock,
      configServiceMock,
      realtimeServiceMock,
      auditLogServiceMock,
    );
  });

  it('returns existing approved deposit on duplicate submission by the same user without throwing', async () => {
    const existingDeposit = {
      id: 'dep-123',
      userId: 'user-1',
      provider: PaymentProvider.TELEBIRR,
      amount: new Prisma.Decimal(50),
      transactionRef: 'REF1234567890',
      status: DepositStatus.APPROVED,
      receiptUrl: null,
      walletTransactionId: 'wt-1',
      verifiedData: {},
      rejectionReason: null,
      verifyEtRequestId: null,
      verifyEtRawResponse: null,
      verifiedAmount: new Prisma.Decimal(50),
      verifiedReceiverName: 'BINGO',
      createdAt: new Date(),
      verifiedAt: new Date(),
      updatedAt: new Date(),
      user: {
        id: 'user-1',
        fullName: 'Player One',
        phoneNumber: '+251911223344',
      },
    };

    prismaMock.deposit.findFirst.mockResolvedValue(existingDeposit);

    const result = await service.createDeposit('user-1', {
      provider: PaymentProvider.TELEBIRR,
      amount: '50.00',
      transactionRef: 'REF1234567890',
    });

    expect(result).toBeDefined();
    expect(result.id).toBe('dep-123');
    expect(result.status).toBe(DepositStatus.APPROVED);
    expect(verifyEtServiceMock.verifyDeposit).not.toHaveBeenCalled();
  });

  it('throws ConflictException when a different user tries to claim an already used reference', async () => {
    const existingDeposit = {
      id: 'dep-123',
      userId: 'different-user',
      provider: PaymentProvider.TELEBIRR,
      amount: new Prisma.Decimal(50),
      transactionRef: 'REF1234567890',
      status: DepositStatus.APPROVED,
      user: { id: 'different-user', fullName: 'Other', phoneNumber: '123' },
    };

    prismaMock.deposit.findFirst.mockResolvedValue(existingDeposit);

    await expect(
      service.createDeposit('user-1', {
        provider: PaymentProvider.TELEBIRR,
        amount: '50.00',
        transactionRef: 'REF1234567890',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
