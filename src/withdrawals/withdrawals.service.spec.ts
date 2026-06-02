import { Prisma, WithdrawStatus } from '@prisma/client';
import { WithdrawalsService } from './withdrawals.service';

describe('WithdrawalsService', () => {
  it('refunds locked balance when a withdrawal is rejected', async () => {
    const withdrawal = {
      id: 'withdrawal-1',
      userId: 'user-1',
      provider: 'TELEBIRR',
      amount: new Prisma.Decimal('100'),
      receiverPhone: '0912345678',
      receiverAccount: null,
      payoutRef: null,
      status: WithdrawStatus.PENDING,
      adminNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      paidAt: null,
      user: {
        id: 'user-1',
        fullName: 'Samuel Mulu',
        phoneNumber: '0912345678',
        role: 'PLAYER',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };

    const tx = {
      withdrawal: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(withdrawal)
          .mockResolvedValueOnce({
            ...withdrawal,
            status: WithdrawStatus.REJECTED,
            adminNote: 'Manual review failed',
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const walletService = {
      releaseLockedFunds: jest.fn().mockResolvedValue(undefined),
      getSerializedWallet: jest.fn().mockResolvedValue({
        id: 'wallet-1',
        userId: 'user-1',
        balance: '100.00',
        lockedBalance: '0.00',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };

    const realtimeService = {
      emitToUser: jest.fn(),
      emitToAdmin: jest.fn(),
      emitToGame: jest.fn(),
    };

    const auditLogService = {
      create: jest.fn().mockResolvedValue(undefined),
    };

    const service = new WithdrawalsService(
      prisma as never,
      walletService as never,
      realtimeService as never,
      auditLogService as never,
    );

    const result = await service.rejectWithdrawal(
      'withdrawal-1',
      { adminNote: 'Manual review failed' },
      'admin-1',
    );

    expect(walletService.releaseLockedFunds).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(WithdrawStatus.REJECTED);
  });
});
