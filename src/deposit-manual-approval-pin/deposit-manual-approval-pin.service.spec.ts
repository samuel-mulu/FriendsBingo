import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DepositManualApprovalPinService } from './deposit-manual-approval-pin.service';
import { DEFAULT_DEPOSIT_MANUAL_APPROVAL_PIN_HASH } from './deposit-manual-approval-pin.defaults';

describe('DepositManualApprovalPinService', () => {
  const auditLogService = {
    create: jest.fn().mockResolvedValue(undefined),
  };

  function createService(
    row: {
      id: string;
      pinHash: string;
      updatedAt: Date;
      updatedById: string | null;
    } | null,
  ) {
    const prisma = {
      depositManualApprovalPinConfig: {
        findUnique: jest.fn().mockResolvedValue(row),
        upsert: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (tx: typeof prisma) => unknown) =>
        fn(prisma),
      ),
    };

    return {
      service: new DepositManualApprovalPinService(
        prisma as never,
        auditLogService as never,
      ),
      prisma,
    };
  }

  it('accepts the legacy default PIN via fallback hash when no DB row exists', async () => {
    const { service } = createService(null);
    await expect(
      service.assertValidApprovalPin('121921'),
    ).resolves.toBeUndefined();
  });

  it('rejects an invalid approval PIN', async () => {
    const { service } = createService(null);
    await expect(service.assertValidApprovalPin('000000')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('changes the PIN when the current PIN is correct', async () => {
    const pinHash = DEFAULT_DEPOSIT_MANUAL_APPROVAL_PIN_HASH;
    const { service, prisma } = createService({
      id: 'default',
      pinHash,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedById: null,
    });

    const newHash = await bcrypt.hash('112233', 10);
    prisma.depositManualApprovalPinConfig.upsert.mockResolvedValue({
      id: 'default',
      pinHash: newHash,
      updatedAt: new Date('2026-10-27T00:00:00.000Z'),
      updatedById: 'admin-1',
    });

    const result = await service.changePin(
      { currentPin: '121921', newPin: '112233' },
      'admin-1',
    );

    expect(result.updatedById).toBe('admin-1');
    expect(result.storedInDatabase).toBe(true);
    await expect(
      service.assertValidApprovalPin('112233'),
    ).resolves.toBeUndefined();
  });
});
