import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DepositApprovalMode,
  DepositStatus,
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
import { DepositsService } from './deposits.service';
import { TelebirrReceiptParseStatus } from './dto/telebirr-receipt-parse-status.enum';

describe('DepositsService LOCAL telebirr', () => {
  const serverReceipt = {
    invoiceNumber: 'DGS1BJ2WJ3',
    transactionStatus: 'Completed',
    settledAmount: '10',
    creditedPartyName: 'Yonas Shiferaw Yowhans',
    creditedPartyAccountNo: '2519****3287',
  };

  function createService(options?: {
    fetchResult?: typeof serverReceipt | null;
    creditWallet?: jest.Mock;
  }) {
    const creditWallet =
      options?.creditWallet ??
      jest.fn(async () => 'wallet-tx-1');
    const depositCreate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'deposit-1',
      userId: 'user-1',
      provider: PaymentProvider.TELEBIRR,
      amount: data.amount,
      transactionRef: data.transactionRef,
      status: DepositStatus.APPROVED,
      receiptUrl: null,
      walletTransactionId: null,
      verifiedData: data.verifiedData,
      rejectionReason: null,
      verifyEtRequestId: null,
      verifyEtRawResponse: null,
      verifiedAmount: data.verifiedAmount ?? null,
      verifiedReceiverName: data.verifiedReceiverName ?? null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      user: {
        id: 'user-1',
        phone: '+251900000000',
        displayName: 'Player',
      },
    }));
    const depositUpdate = jest.fn(async () => undefined);
    const depositFindUnique = jest.fn(async () => ({
      id: 'deposit-1',
      userId: 'user-1',
      provider: PaymentProvider.TELEBIRR,
      amount: new Prisma.Decimal('10'),
      transactionRef: 'DGS1BJ2WJ3',
      status: DepositStatus.APPROVED,
      receiptUrl: null,
      walletTransactionId: 'wallet-tx-1',
      verifiedData: { verificationSource: 'telebirr.local' },
      rejectionReason: null,
      verifyEtRequestId: null,
      verifyEtRawResponse: null,
      verifiedAmount: new Prisma.Decimal('10'),
      verifiedReceiverName: 'Yonas Shiferaw Yowhans',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      user: {
        id: 'user-1',
        phone: '+251900000000',
        displayName: 'Player',
      },
    }));
    const depositFindFirst = jest.fn(async () => null);

    const prisma = {
      deposit: {
        findFirst: depositFindFirst,
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          deposit: {
            create: depositCreate,
            update: depositUpdate,
            findUnique: depositFindUnique,
          },
        }),
      ),
    } as unknown as PrismaService;

    const walletService = {
      creditWallet,
      getSerializedWallet: jest.fn(async () => ({
        userId: 'user-1',
        balance: '10',
      })),
    } as unknown as WalletService;

    const verifyEtService = {} as VerifyEtService;

    const depositApprovalConfigService = {
      getMode: jest.fn(async () => DepositApprovalMode.LOCAL),
    } as unknown as DepositApprovalConfigService;

    const telebirrReceiptFetchService = {
      fetchClientReceipt: jest.fn(async () =>
        options?.fetchResult === undefined
          ? serverReceipt
          : options.fetchResult,
      ),
    } as unknown as TelebirrReceiptFetchService;

    const configService = {
      get: (key: string) => {
        const values: Record<string, string> = {
          TELEBIRR_SETTLEMENT_ACCOUNT: '0952723287',
          TELEBIRR_RECEIVER_PHONE: '0952723287',
          TELEBIRR_RECEIVER_PHONE_LAST4: '3287',
          TELEBIRR_RECEIVER_NAME: 'Yonas shiferaw yowhans',
          CBE_RECEIPT_BASE_URL: 'https://mbreciept.cbe.com.et/receipt',
        };
        return values[key];
      },
    } as unknown as ConfigService;

    const realtimeService = {
      emitToUser: jest.fn(),
      emitToAdmin: jest.fn(),
    } as unknown as RealtimeService;

    const auditLogService = {} as AuditLogService;
    const notificationsService = {
      sendAppNotificationToUser: jest.fn(async () => ({
        userId: 'user-1',
        sentCount: 0,
        failedCount: 0,
      })),
    } as unknown as NotificationsService;
    const userActionRateLimitService = {
      assertWithinLimit: jest.fn(),
    } as unknown as UserActionRateLimitService;

    const service = new DepositsService(
      prisma,
      walletService,
      verifyEtService,
      depositApprovalConfigService,
      telebirrReceiptFetchService,
      configService,
      realtimeService,
      auditLogService,
      notificationsService,
      userActionRateLimitService,
    );

    return {
      service,
      creditWallet,
      telebirrReceiptFetchService,
      depositCreate,
    };
  }

  it('ignores forged client receipt and credits from server-fetched receipt', async () => {
    const { service, creditWallet, telebirrReceiptFetchService, depositCreate } =
      createService();

    const result = await service.createDeposit('user-1', {
      provider: PaymentProvider.TELEBIRR,
      amount: '10',
      transactionRef: 'DGS1BJ2WJ3',
      receiptParseStatus: TelebirrReceiptParseStatus.PARSED,
      clientReceipt: {
        invoiceNumber: 'DGS1BJ2WJ3',
        transactionStatus: 'Completed',
        settledAmount: '9999',
        creditedPartyName: 'Attacker',
        creditedPartyAccountNo: '2519****9999',
      },
    });

    expect(
      (telebirrReceiptFetchService.fetchClientReceipt as jest.Mock).mock.calls,
    ).toHaveLength(1);
    expect(creditWallet).toHaveBeenCalledTimes(1);
    expect(depositCreate).toHaveBeenCalled();
    expect(result.status).toBe(DepositStatus.APPROVED);

    const verifiedData = depositCreate.mock.calls[0][0].data.verifiedData as {
      receiptAuthority?: string;
      clientReceipt?: { settledAmount?: string };
    };
    expect(verifiedData.receiptAuthority).toBe('server.fetch');
    expect(verifiedData.clientReceipt?.settledAmount).toBe('10');
  });

  it('does not credit wallet when server receipt fetch fails', async () => {
    const { service, creditWallet } = createService({ fetchResult: null });

    await expect(
      service.createDeposit('user-1', {
        provider: PaymentProvider.TELEBIRR,
        amount: '10',
        transactionRef: 'DGS1BJ2WJ3',
        receiptParseStatus: TelebirrReceiptParseStatus.PARSED,
        clientReceipt: serverReceipt,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(creditWallet).not.toHaveBeenCalled();
  });

  it('does not credit wallet when server receipt amount mismatches', async () => {
    const { service, creditWallet } = createService({
      fetchResult: {
        ...serverReceipt,
        settledAmount: '25',
      },
    });

    await expect(
      service.createDeposit('user-1', {
        provider: PaymentProvider.TELEBIRR,
        amount: '10',
        transactionRef: 'DGS1BJ2WJ3',
      }),
    ).rejects.toMatchObject({
      response: { code: 'AMOUNT_MISMATCH' },
    });

    expect(creditWallet).not.toHaveBeenCalled();
  });
});
