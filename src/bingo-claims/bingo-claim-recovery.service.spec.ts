import { ConfigService } from '@nestjs/config';
import { BingoClaimRecoveryService } from './bingo-claim-recovery.service';
import { envValidationSchema } from '../config/env.validation';

describe('CHECKING recovery worker lifecycle', () => {
  let recover: jest.Mock;
  let worker: BingoClaimRecoveryService;

  function create(enabled?: boolean) {
    recover = jest.fn().mockResolvedValue({ candidates: 0, recovered: 0 });
    worker = new BingoClaimRecoveryService(
      new ConfigService({ BINGO_CLAIM_RECOVERY_ENABLED: enabled }),
      { recoverOrphanedCheckingClaims: recover } as never,
    );
    jest.spyOn((worker as any).logger, 'error').mockImplementation(() => {});
    return worker;
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(async () => {
    await worker?.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('environment defaults recovery to true and parses explicit false', () => {
    const flag = envValidationSchema.extract('BINGO_CLAIM_RECOVERY_ENABLED');
    expect(flag.validate(undefined).value).toBe(true);
    expect(flag.validate('false').value).toBe(false);
    expect(flag.validate('true').value).toBe(true);
  });

  it.each([false, 'false'] as any[])(
    'disabled (%s): no startup scan or timer',
    async (enabled) => {
      create(enabled).onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(20_000);
      expect(recover).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('enabled by default (undefined): runs startup scan and sets timer', async () => {
    create(undefined).onApplicationBootstrap();
    expect(recover).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it('enabled: startup scan, then one scan every five seconds', async () => {
    create(true).onApplicationBootstrap();
    expect(recover).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(4999);
    expect(recover).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it('overlapping timer ticks do not start competing scans', async () => {
    create(true);
    let release!: () => void;
    recover.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(15_000);
    expect(recover).toHaveBeenCalledTimes(1);
    release();
    await jest.advanceTimersByTimeAsync(5000);
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it('shutdown clears timer, waits for in-flight scan and starts no further work', async () => {
    create(true);
    let release!: () => void;
    recover.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    worker.onApplicationBootstrap();
    let stopped = false;
    const shutdown = worker.onModuleDestroy().then(() => {
      stopped = true;
    });
    await jest.advanceTimersByTimeAsync(15_000);
    expect(stopped).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    release();
    await shutdown;
    await jest.advanceTimersByTimeAsync(15_000);
    expect(stopped).toBe(true);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('scan failure is caught and the next tick retries', async () => {
    create(true);
    recover.mockRejectedValueOnce(new Error('database unavailable'));
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5000);
    expect(recover).toHaveBeenCalledTimes(2);
    expect((worker as any).logger.error).toHaveBeenCalledTimes(1);
  });
});

describe('Orphaned CHECKING claim recovery execution', () => {
  it('converts a CHECKING claim older than 60s to FAILED and restores the stored autoCallPausedRemainingMs', async () => {
    const claimId = 'claim-orphan-1';
    const sessionId = 'session-1';
    const now = Date.now();
    const storedRemainingMs = 5500;

    const mockPrisma: any = {
      $transaction: jest.fn((cb: any) => cb(mockPrisma)),
      $queryRaw: jest.fn().mockImplementation((query: any) => {
        const sql = query.strings ? query.strings.join('') : String(query);
        if (sql.includes('GameSession')) {
          return Promise.resolve([{ id: sessionId }]);
        }
        if (sql.includes('BingoClaim')) {
          return Promise.resolve([{ status: 'CHECKING' }]);
        }
        return Promise.resolve([]);
      }),
      bingoClaim: {
        findMany: jest.fn().mockResolvedValue([
          { id: claimId, gameSessionId: sessionId },
        ]),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: claimId,
          receivedAt: new Date(now - 70_000),
          gameSession: { id: sessionId, gameSlotId: 'slot-1', status: 'PLAYING' },
          gameCartela: { cartela: { select: { number: 7 } } },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: claimId,
          claimAttemptId: 'attempt-orphan-1',
          userId: 'user-1',
          gameSessionId: sessionId,
          gameCartelaId: 'cartela-1',
          status: 'FAILED',
          attemptNumber: 1,
          rejectionReason: null,
          createdAt: new Date(),
          gameCartela: { status: 'REGISTERED', isWinner: false },
          gameSession: { status: 'PLAYING', nextAutoCallAt: null, winnerWindowEndsAt: null },
        }),
      },
      gameCartela: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cartela-1',
          status: 'REGISTERED',
          isWinner: false,
          gameSession: { status: 'PLAYING', nextAutoCallAt: null, winnerWindowEndsAt: null },
        }),
      },
      gameSession: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          status: 'PLAYING',
          autoCallEnabled: true,
          autoCallIntervalMs: 18000,
          nextAutoCallAt: null,
          autoCallPausedRemainingMs: storedRemainingMs,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };

    const mockAuditLog: any = { create: jest.fn().mockResolvedValue(undefined) };
    const mockRealtime: any = { emitToGame: jest.fn(), emitToAdmin: jest.fn(), emitToUser: jest.fn() };
    const mockTiming: any = { getAutoCallIntervalMs: jest.fn().mockResolvedValue(18000) };
    const mockPerf: any = { run: jest.fn((_meta: any, fn: any) => fn()) };
    const mockReqCtx: any = { getRequestIdForLog: jest.fn().mockReturnValue('req-orphan') };

    const { BingoClaimsService } = require('./bingo-claims.service');
    const claimsService = new BingoClaimsService(
      mockPrisma,
      {} as any,
      {} as any,
      mockRealtime,
      mockAuditLog,
      {} as any,
      {} as any,
      mockPerf,
      mockTiming,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      mockReqCtx,
    );

    const result = await claimsService.recoverOrphanedCheckingClaims();
    expect(result.recovered).toBe(1);

    expect(mockPrisma.bingoClaim.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: claimId, status: 'CHECKING' },
        data: expect.objectContaining({
          status: 'FAILED',
          failureCode: 'CLAIM_ORPHANED',
        }),
      }),
    );

    expect(mockPrisma.gameSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: sessionId }),
        data: expect.objectContaining({
          autoCallPausedRemainingMs: null,
          nextAutoCallAt: expect.any(Date),
        }),
      }),
    );
  });
});
