import { BadRequestException } from '@nestjs/common';
import { DepositApprovalMode, PaymentProvider } from '@prisma/client';
import { DepositApprovalConfigService } from './deposit-approval-config.service';

describe('DepositApprovalConfigService - Circuit Breaker', () => {
  let service: DepositApprovalConfigService;
  let mockPrisma: any;
  let mockAuditLogService: any;

  beforeEach(() => {
    mockPrisma = {
      depositApprovalConfig: {
        findMany: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      depositCircuitBreakerFailure: {
        create: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockPrisma)),
    };

    mockAuditLogService = {
      create: jest.fn(),
    };

    service = new DepositApprovalConfigService(mockPrisma, mockAuditLogService);
  });

  describe('getMode', () => {
    it('returns LOCAL for LOCAL_WITH_FALLBACK when fallbackUntil is null', async () => {
      mockPrisma.depositApprovalConfig.findMany.mockResolvedValue([
        {
          provider: PaymentProvider.TELEBIRR,
          enabled: true,
          approvalMode: DepositApprovalMode.LOCAL_WITH_FALLBACK,
          fallbackThreshold: 2,
          fallbackWindowMinutes: 3,
          fallbackDurationMinutes: 30,
          fallbackUntil: null,
          fallbackReason: null,
          updatedAt: new Date(),
          updatedById: null,
        },
      ]);

      const mode = await service.getMode(PaymentProvider.TELEBIRR);
      expect(mode).toBe(DepositApprovalMode.LOCAL);
    });

    it('returns AUTOMATIC for LOCAL_WITH_FALLBACK when fallbackUntil is active in future', async () => {
      const futureDate = new Date(Date.now() + 15 * 60_000);
      mockPrisma.depositApprovalConfig.findMany.mockResolvedValue([
        {
          provider: PaymentProvider.TELEBIRR,
          enabled: true,
          approvalMode: DepositApprovalMode.LOCAL_WITH_FALLBACK,
          fallbackThreshold: 2,
          fallbackWindowMinutes: 3,
          fallbackDurationMinutes: 30,
          fallbackUntil: futureDate,
          fallbackReason: 'Rate limit tripped',
          updatedAt: new Date(),
          updatedById: null,
        },
      ]);

      const mode = await service.getMode(PaymentProvider.TELEBIRR);
      expect(mode).toBe(DepositApprovalMode.AUTOMATIC);
    });

    it('returns LOCAL for LOCAL_WITH_FALLBACK when fallbackUntil has elapsed', async () => {
      const pastDate = new Date(Date.now() - 10_000);
      mockPrisma.depositApprovalConfig.findMany.mockResolvedValue([
        {
          provider: PaymentProvider.TELEBIRR,
          enabled: true,
          approvalMode: DepositApprovalMode.LOCAL_WITH_FALLBACK,
          fallbackThreshold: 2,
          fallbackWindowMinutes: 3,
          fallbackDurationMinutes: 30,
          fallbackUntil: pastDate,
          fallbackReason: 'Previous trip',
          updatedAt: new Date(),
          updatedById: null,
        },
      ]);

      const mode = await service.getMode(PaymentProvider.TELEBIRR);
      expect(mode).toBe(DepositApprovalMode.LOCAL);
    });

    it('returns existing modes untouched', async () => {
      mockPrisma.depositApprovalConfig.findMany.mockResolvedValue([
        {
          provider: PaymentProvider.CBE,
          enabled: true,
          approvalMode: DepositApprovalMode.AUTOMATIC,
          fallbackThreshold: 2,
          fallbackWindowMinutes: 3,
          fallbackDurationMinutes: 30,
          fallbackUntil: null,
          fallbackReason: null,
          updatedAt: new Date(),
          updatedById: null,
        },
      ]);

      const mode = await service.getMode(PaymentProvider.CBE);
      expect(mode).toBe(DepositApprovalMode.AUTOMATIC);
    });
  });

  describe('recordLookupFailure', () => {
    it('does not trip when failures count is below threshold', async () => {
      mockPrisma.depositApprovalConfig.findMany.mockResolvedValue([
        {
          provider: PaymentProvider.TELEBIRR,
          enabled: true,
          approvalMode: DepositApprovalMode.LOCAL_WITH_FALLBACK,
          fallbackThreshold: 2,
          fallbackWindowMinutes: 3,
          fallbackDurationMinutes: 30,
          fallbackUntil: null,
          fallbackReason: null,
          updatedAt: new Date(),
          updatedById: null,
        },
      ]);
      mockPrisma.depositCircuitBreakerFailure.count.mockResolvedValue(1);

      const result = await service.recordLookupFailure({
        transactionRef: 'REF123',
        reason: 'HTTP 429',
      });

      expect(result.tripped).toBe(false);
      expect(mockPrisma.depositCircuitBreakerFailure.create).toHaveBeenCalled();
      expect(mockPrisma.depositApprovalConfig.update).not.toHaveBeenCalled();
    });

    it('trips and sets fallbackUntil when failure count reaches threshold', async () => {
      mockPrisma.depositApprovalConfig.findMany.mockResolvedValue([
        {
          provider: PaymentProvider.TELEBIRR,
          enabled: true,
          approvalMode: DepositApprovalMode.LOCAL_WITH_FALLBACK,
          fallbackThreshold: 2,
          fallbackWindowMinutes: 3,
          fallbackDurationMinutes: 30,
          fallbackUntil: null,
          fallbackReason: null,
          updatedAt: new Date(),
          updatedById: null,
        },
      ]);
      mockPrisma.depositCircuitBreakerFailure.count.mockResolvedValue(2);
      mockPrisma.depositApprovalConfig.update.mockResolvedValue({});

      const result = await service.recordLookupFailure({
        transactionRef: 'REF123',
        reason: 'HTTP 429',
      });

      expect(result.tripped).toBe(true);
      expect(result.fallbackUntil).toBeDefined();
      expect(mockPrisma.depositApprovalConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider: PaymentProvider.TELEBIRR },
          data: expect.objectContaining({
            fallbackUntil: expect.any(Date),
            fallbackReason: expect.stringContaining('upstream failures'),
          }),
        }),
      );
    });

    it('preserves timer immutability: never extends fallbackUntil when already active', async () => {
      const activeFallbackUntil = new Date(Date.now() + 20 * 60_000);
      mockPrisma.depositApprovalConfig.findMany.mockResolvedValue([
        {
          provider: PaymentProvider.TELEBIRR,
          enabled: true,
          approvalMode: DepositApprovalMode.LOCAL_WITH_FALLBACK,
          fallbackThreshold: 2,
          fallbackWindowMinutes: 3,
          fallbackDurationMinutes: 30,
          fallbackUntil: activeFallbackUntil,
          fallbackReason: 'Already tripped',
          updatedAt: new Date(),
          updatedById: null,
        },
      ]);

      const result = await service.recordLookupFailure({
        transactionRef: 'REF999',
        reason: 'HTTP 429 during active window',
      });

      expect(result.tripped).toBe(false);
      expect(result.fallbackUntil).toEqual(activeFallbackUntil);
      expect(mockPrisma.depositApprovalConfig.update).not.toHaveBeenCalled();
    });
  });

  describe('resetFallback', () => {
    it('clears fallbackUntil and purges failures table', async () => {
      mockPrisma.depositApprovalConfig.update.mockResolvedValue({});
      mockPrisma.depositCircuitBreakerFailure.deleteMany.mockResolvedValue({});
      mockPrisma.depositApprovalConfig.findMany.mockResolvedValue([]);

      await service.resetFallback(PaymentProvider.TELEBIRR, 'admin-123');

      expect(mockPrisma.depositApprovalConfig.update).toHaveBeenCalledWith({
        where: { provider: PaymentProvider.TELEBIRR },
        data: {
          fallbackUntil: null,
          fallbackReason: null,
        },
      });
      expect(mockPrisma.depositCircuitBreakerFailure.deleteMany).toHaveBeenCalledWith({
        where: { provider: PaymentProvider.TELEBIRR },
      });
      expect(mockAuditLogService.create).toHaveBeenCalled();
    });
  });
});
