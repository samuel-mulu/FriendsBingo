import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GameCartelaStatus, GameStatus, Prisma } from '@prisma/client';
import { BingoClaimsService } from './bingo-claims.service';
import { PrismaService } from '../prisma/prisma.service';
import { GameEngineService } from '../game-engine/game-engine.service';
import { GameRuleEvaluationService } from '../game-rules/game-rule-evaluation.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuditLogService } from '../common/services/audit-log.service';
import { WalletService } from '../wallet/wallet.service';
import { GameQueueService } from '../games/game-queue.service';
import { RequestPerformanceContext } from '../common/performance/request-performance.context';
import { GameTimingConfigService } from '../game-timing-config/game-timing-config.service';
import { OperationsCacheService } from '../games/operations-cache.service';
import { PostGameRegistrationOpenerService } from '../games/post-game-registration-opener.service';
import { GamePushNotificationsService } from '../notifications/game-push-notifications.service';
import { BigGameTicketService } from '../games/big-game-ticket.service';
import { BigGameRoundService } from '../games/big-game-round.service';
import { ChainRoundService } from '../games/chain-round.service';
import { RequestContextService } from '../observability/request-context.service';

describe('BingoClaimsService Unit Tests', () => {
  let service: BingoClaimsService;
  let prismaMock: any;
  let gameEngineServiceMock: any;
  let gameRuleEvaluationServiceMock: any;
  let realtimeServiceMock: any;
  let auditLogServiceMock: any;
  let walletServiceMock: any;
  let gameQueueServiceMock: any;
  let requestPerformanceMock: any;
  let gameTimingConfigServiceMock: any;
  let operationsCacheServiceMock: any;
  let postGameRegistrationOpenerServiceMock: any;
  let gamePushNotificationsServiceMock: any;
  let bigGameTicketServiceMock: any;
  let bigGameRoundServiceMock: any;
  let chainRoundServiceMock: any;
  let requestContextMock: any;

  beforeEach(() => {
    prismaMock = {
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(prismaMock)),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'session-1' }]),
      gameCartela: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
      },
      gameSession: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      bingoClaim: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'claim-1', attemptNumber: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      calledNumber: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    gameEngineServiceMock = {
      emitSessionFinished: jest.fn().mockResolvedValue(undefined),
    };
    gameRuleEvaluationServiceMock = {
      isManualRule: jest.fn().mockReturnValue(false),
      evaluate: jest.fn(),
    };
    realtimeServiceMock = {
      emitToGame: jest.fn(),
      emitToUser: jest.fn(),
      emitToAdmin: jest.fn(),
    };
    auditLogServiceMock = {
      create: jest.fn().mockResolvedValue(undefined),
    };
    walletServiceMock = {
      creditWallet: jest.fn().mockResolvedValue(undefined),
      getSerializedWallet: jest.fn().mockResolvedValue({ balance: 100 }),
    };
    gameQueueServiceMock = {
      restoreSlotAfterSession: jest.fn().mockResolvedValue(undefined),
    };
    requestPerformanceMock = {
      run: jest.fn((_meta: unknown, fn: () => any) => fn()),
    };
    gameTimingConfigServiceMock = {
      getWinnerWindowClaimGraceMs: jest.fn().mockResolvedValue(1000),
      getAutoCallIntervalMs: jest.fn().mockResolvedValue(18000),
      getWinnerWindowDurationMs: jest.fn().mockResolvedValue(15000),
    };
    operationsCacheServiceMock = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };
    postGameRegistrationOpenerServiceMock = {
      openNextAutoQueueRegistrationInTransaction: jest
        .fn()
        .mockResolvedValue(null),
      finalizeOpenedRegistration: jest.fn().mockResolvedValue(undefined),
    };
    gamePushNotificationsServiceMock = {
      sendBingoWinNotification: jest.fn(),
    };
    bigGameTicketServiceMock = {
      findActiveBigGameSlot: jest.fn().mockResolvedValue(null),
      grantTickets: jest.fn().mockResolvedValue(undefined),
    };
    bigGameRoundServiceMock = {};
    chainRoundServiceMock = {
      isChainSlot: jest.fn().mockReturnValue(false),
      resolveActiveRoundPrize: jest
        .fn()
        .mockReturnValue(new Prisma.Decimal(100)),
    };
    requestContextMock = {
      getRequestIdForLog: jest.fn().mockReturnValue('req-test-123'),
    };

    service = new BingoClaimsService(
      prismaMock as unknown as PrismaService,
      gameEngineServiceMock as unknown as GameEngineService,
      gameRuleEvaluationServiceMock as unknown as GameRuleEvaluationService,
      realtimeServiceMock as unknown as RealtimeService,
      auditLogServiceMock as unknown as AuditLogService,
      walletServiceMock as unknown as WalletService,
      gameQueueServiceMock as unknown as GameQueueService,
      requestPerformanceMock as unknown as RequestPerformanceContext,
      gameTimingConfigServiceMock as unknown as GameTimingConfigService,
      operationsCacheServiceMock as unknown as OperationsCacheService,
      postGameRegistrationOpenerServiceMock as unknown as PostGameRegistrationOpenerService,
      gamePushNotificationsServiceMock as unknown as GamePushNotificationsService,
      bigGameTicketServiceMock as unknown as BigGameTicketService,
      bigGameRoundServiceMock as unknown as BigGameRoundService,
      chainRoundServiceMock as unknown as ChainRoundService,
      requestContextMock as unknown as RequestContextService,
    );
  });

  describe('Relational Integrity in loadClaimCartela', () => {
    it('throws NotFoundException if cartela does not exist', async () => {
      prismaMock.gameCartela.findUnique.mockResolvedValue(null);

      await expect(
        service.claimBingo('session-1', 'user-1', 'cartela-999'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if cartela belongs to a different session', async () => {
      prismaMock.gameCartela.findUnique.mockResolvedValue({
        id: 'cartela-1',
        gameSessionId: 'different-session',
        userId: 'user-1',
        status: GameCartelaStatus.REGISTERED,
        isWinner: false,
        cartela: { id: 'c1', number: 12 },
        gameSession: { id: 'different-session', status: GameStatus.PLAYING },
      });

      await expect(
        service.claimBingo('session-1', 'user-1', 'cartela-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException if cartela belongs to a different user', async () => {
      prismaMock.gameCartela.findUnique.mockResolvedValue({
        id: 'cartela-1',
        gameSessionId: 'session-1',
        userId: 'different-user',
        status: GameCartelaStatus.REGISTERED,
        isWinner: false,
        cartela: { id: 'c1', number: 12 },
        gameSession: { id: 'session-1', status: GameStatus.PLAYING },
      });

      await expect(
        service.claimBingo('session-1', 'user-1', 'cartela-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('does not emit early game:bingo_checking when claimAttemptId already exists (idempotency)', async () => {
      prismaMock.bingoClaim.findUnique.mockResolvedValue({
        id: 'claim-1',
        claimAttemptId: 'attempt-123',
        userId: 'user-1',
        gameSessionId: 'session-1',
        gameCartelaId: 'cartela-1',
        status: 'VALID',
        attemptNumber: 1,
        rejectionReason: null,
        createdAt: new Date(),
        gameCartela: { status: 'WON', isWinner: true },
        gameSession: {
          status: 'WINNER_WINDOW',
          nextAutoCallAt: null,
          winnerWindowEndsAt: new Date(),
        },
      });
      prismaMock.gameCartela.findUnique.mockResolvedValue({
        id: 'cartela-1',
        gameSessionId: 'session-1',
        userId: 'user-1',
        status: GameCartelaStatus.REGISTERED,
        isWinner: false,
        cartela: { number: 42 },
        gameSession: { status: GameStatus.PLAYING },
      });

      await service.claimBingo('session-1', 'user-1', 'cartela-1', {
        claimAttemptId: 'attempt-123',
      });

      await new Promise((resolve) => setImmediate(resolve));

      expect(realtimeServiceMock.emitToGame).not.toHaveBeenCalledWith(
        'session-1',
        'game:bingo_checking',
        expect.anything(),
      );
    });
  });

  describe('finalizeWinnerWindow fail-safe', () => {
    it('successfully finalizes session even if opening next auto registration throws', async () => {
      prismaMock.gameSession.updateMany
        .mockResolvedValueOnce({ count: 1 }) // lock update
        .mockResolvedValueOnce({ count: 1 }); // finish update

      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: 'session-1',
        playCode: 'PLAY-101',
        prizeAmount: new Prisma.Decimal(100),
        gameSlotId: 'slot-1',
        gameSlot: {
          id: 'slot-1',
          category: 'STANDARD',
          forceBigGameEnabled: false,
        },
        gameCartelas: [
          { id: 'cartela-1', userId: 'user-1', cartela: { number: 1 } },
          { id: 'cartela-2', userId: 'user-2', cartela: { number: 2 } },
        ],
      });

      postGameRegistrationOpenerServiceMock.openNextAutoQueueRegistrationInTransaction.mockRejectedValueOnce(
        new Error('Auto queue registration busy'),
      );

      const result = await service.finalizeWinnerWindow('session-1');

      expect(result).toBeDefined();
      expect(result?.sessionId).toBe('session-1');
      expect(result?.winnerUserIds).toEqual(['user-1', 'user-2']);
      expect(walletServiceMock.creditWallet).toHaveBeenCalledTimes(2);
      expect(gameEngineServiceMock.emitSessionFinished).toHaveBeenCalledWith(
        'session-1',
        { openedNextRegistration: false },
      );
    });

    it('defers finalization (returns null) when a CHECKING claim is in-flight within 25s cutoff', async () => {
      prismaMock.bingoClaim.count = jest.fn().mockImplementation((args: any) => {
        if (args?.where?.status === 'CHECKING') {
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      });

      const result = await service.finalizeWinnerWindow('session-1');
      expect(result).toBeNull();
      expect(walletServiceMock.creditWallet).not.toHaveBeenCalled();
    });

    it('does not block finalization when a CHECKING claim is older than 25s (2-minute orphan)', async () => {
      prismaMock.bingoClaim.count = jest.fn().mockImplementation((args: any) => {
        if (args?.where?.receivedAt?.gte) {
          return Promise.resolve(0);
        }
        return Promise.resolve(1);
      });

      prismaMock.gameSession.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 1 });

      prismaMock.gameSession.findUnique.mockResolvedValue({
        id: 'session-1',
        playCode: 'PLAY-101',
        prizeAmount: new Prisma.Decimal(100),
        gameSlotId: 'slot-1',
        gameSlot: {
          id: 'slot-1',
          category: 'STANDARD',
          forceBigGameEnabled: false,
        },
        gameCartelas: [
          { id: 'cartela-1', userId: 'user-1', cartela: { number: 1 } },
        ],
      });

      const result = await service.finalizeWinnerWindow('session-1');
      expect(result).toBeDefined();
      expect(result?.sessionId).toBe('session-1');
      expect(walletServiceMock.creditWallet).toHaveBeenCalled();
    });
  });

  describe('Task 1: autoCallPausedRemainingMs session column and countdown preservation', () => {
    it('restores approximately 7s remaining (not 18s default) when the last of concurrent invalid claims finishes', async () => {
      const now = Date.now();
      const sevenSecondsRemaining = 7000;
      prismaMock.gameSession.findUniqueOrThrow = jest.fn().mockResolvedValue({
        id: 'session-1',
        status: GameStatus.PLAYING,
        autoCallEnabled: true,
        autoCallIntervalMs: 18000,
        nextAutoCallAt: null,
        autoCallPausedRemainingMs: sevenSecondsRemaining,
      });

      let updatedData: any = null;
      prismaMock.gameSession.updateMany = jest
        .fn()
        .mockImplementation((args: any) => {
          updatedData = args.data;
          return Promise.resolve({ count: 1 });
        });

      const session = await (service as any).restorePausedClaimAutoCall(
        prismaMock,
        'session-1',
        18000,
      );

      expect(updatedData).toBeDefined();
      expect(updatedData.autoCallPausedRemainingMs).toBeNull(); // Cleared on restore!
      expect(updatedData.nextAutoCallAt).toBeDefined();
      const restoredMs = updatedData.nextAutoCallAt.getTime() - now;
      expect(restoredMs).toBeGreaterThanOrEqual(6000);
      expect(restoredMs).toBeLessThanOrEqual(8000);
      expect(session.nextAutoCallAt).toEqual(updatedData.nextAutoCallAt);
    });

    it('acceptClaimAttempt saves autoCallPausedRemainingMs only on the first claim and leaves it alone on subsequent claims', async () => {
      const now = Date.now();
      const scheduledAt = new Date(now + 7000);

      const gameCartela1 = {
        id: 'cartela-1',
        gameSessionId: 'session-1',
        userId: 'user-1',
        status: GameCartelaStatus.REGISTERED,
        isWinner: false,
        cartela: { id: 'c1', number: 1, b: [], i: [], n: [], g: [], o: [] },
        gameSession: {
          id: 'session-1',
          playCode: 'PLAY-1',
          status: GameStatus.PLAYING,
          prizeAmount: new Prisma.Decimal(100),
          autoCallEnabled: true,
          autoCallIntervalMs: 18000,
          nextAutoCallAt: scheduledAt,
          autoCallPausedRemainingMs: null,
          winnerWindowEndsAt: null,
          roundIndex: 1,
          gameRule: {
            id: 'r1',
            key: 'FIVE_IN_A_ROW',
            name: 'Standard',
            patterns: [],
          },
          gameSlot: { id: 's1', gameType: 'REGULAR', gameRule: null },
        },
      };

      prismaMock.gameCartela.findUnique.mockResolvedValue(gameCartela1);
      prismaMock.bingoClaim.findFirst.mockResolvedValue(null);
      prismaMock.bingoClaim.count.mockResolvedValue(0);
      prismaMock.calledNumber.findFirst.mockResolvedValue(null);
      prismaMock.calledNumber.count.mockResolvedValue(0);
      prismaMock.bingoClaim.create.mockResolvedValue({
        id: 'claim-1',
        claimAttemptId: 'attempt-1',
        attemptNumber: 1,
        receivedAt: new Date(),
      });

      let sessionUpdates: any[] = [];
      prismaMock.gameSession.updateMany = jest
        .fn()
        .mockImplementation((args: any) => {
          sessionUpdates.push(args.data);
          return Promise.resolve({ count: 1 });
        });

      await (service as any).acceptClaimAttempt(prismaMock, {
        sessionId: 'session-1',
        userId: 'user-1',
        gameCartelaId: 'cartela-1',
        claimAttemptId: 'attempt-1',
        claimSource: 'MANUAL',
        clientTapAt: null,
        requestId: 'req-1',
      });

      expect(sessionUpdates.length).toBeGreaterThan(0);
      const firstUpdate = sessionUpdates[0];
      expect(firstUpdate.nextAutoCallAt).toBeNull();
      expect(firstUpdate.autoCallPausedRemainingMs).toBeGreaterThanOrEqual(
        6500,
      );
      expect(firstUpdate.autoCallPausedRemainingMs).toBeLessThanOrEqual(7500);

      sessionUpdates = [];
      const gameCartela2 = {
        ...gameCartela1,
        id: 'cartela-2',
        gameSession: {
          ...gameCartela1.gameSession,
          nextAutoCallAt: null,
          autoCallPausedRemainingMs: firstUpdate.autoCallPausedRemainingMs,
        },
      };
      prismaMock.gameCartela.findUnique.mockResolvedValue(gameCartela2);
      prismaMock.bingoClaim.create.mockResolvedValue({
        id: 'claim-2',
        claimAttemptId: 'attempt-2',
        attemptNumber: 1,
        receivedAt: new Date(),
      });

      await (service as any).acceptClaimAttempt(prismaMock, {
        sessionId: 'session-1',
        userId: 'user-1',
        gameCartelaId: 'cartela-2',
        claimAttemptId: 'attempt-2',
        claimSource: 'MANUAL',
        clientTapAt: null,
        requestId: 'req-2',
      });

      expect(sessionUpdates.length).toBe(0);
    });
  });

  describe('Task 4: Server-side late-claim grace and pattern-only blocking', () => {
    const baseCartelaRecord: any = {
      id: 'cartela-1',
      gameSessionId: 'session-1',
      userId: 'user-1',
      status: GameCartelaStatus.REGISTERED,
      isWinner: false,
      cartela: { id: 'c1', number: 12, b: [], i: [], n: [], g: [], o: [] },
      gameSession: {
        id: 'session-1',
        playCode: 'PLAY-1',
        status: GameStatus.PLAYING,
        prizeAmount: new Prisma.Decimal(100),
        autoCallEnabled: true,
        autoCallIntervalMs: 18000,
        nextAutoCallAt: null,
        winnerWindowEndsAt: null,
        roundIndex: 1,
        gameRule: { id: 'r1', key: 'FIVE_IN_A_ROW', name: 'Standard', patterns: [] },
        gameSlot: { id: 's1', gameType: 'REGULAR', gameRule: null },
      },
    };

    beforeEach(() => {
      prismaMock.$queryRaw = jest.fn().mockImplementation((query: any) => {
        const sql = query.strings ? query.strings.join('') : String(query);
        if (sql.includes('GameSession')) {
          return Promise.resolve([{ id: 'session-1' }]);
        }
        if (sql.includes('BingoClaim')) {
          return Promise.resolve([
            { status: 'CHECKING', receiptCalledOrder: 2, calledNumbersCountAtReceipt: 2 },
          ]);
        }
        return Promise.resolve([]);
      });

      prismaMock.gameCartela.findUniqueOrThrow = jest.fn().mockResolvedValue({
        status: GameCartelaStatus.REGISTERED,
        isWinner: false,
        gameSession: {
          status: GameStatus.PLAYING,
          roundIndex: 1,
          autoCallEnabled: true,
          autoCallIntervalMs: 18000,
          nextAutoCallAt: null,
          winnerWindowEndsAt: null,
        },
      });

      prismaMock.gameSession.findUniqueOrThrow = jest.fn().mockResolvedValue({
        id: 'session-1',
        status: GameStatus.PLAYING,
        autoCallEnabled: true,
        autoCallIntervalMs: 18000,
        nextAutoCallAt: null,
        autoCallPausedRemainingMs: null,
      });

      prismaMock.bingoClaim.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prismaMock.gameSession.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prismaMock.bingoClaim.findUniqueOrThrow = jest.fn().mockResolvedValue({
        id: 'claim-1',
        claimAttemptId: 'attempt-1',
        userId: 'user-1',
        gameSessionId: 'session-1',
        gameCartelaId: 'cartela-1',
        status: 'VALID',
        attemptNumber: 1,
        rejectionReason: null,
        createdAt: new Date(),
        gameCartela: { status: 'REGISTERED', isWinner: false },
        gameSession: { status: 'PLAYING', nextAutoCallAt: null, winnerWindowEndsAt: null },
      });
      prismaMock.gameCartela.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    });

    it('accepts claim 1s after next ball when previous ball completed pattern (within 1.5s grace)', async () => {
      const now = Date.now();
      const ball1 = { letter: 'B', number: 5, order: 1, createdAt: new Date(now - 10_000) };
      const ball2 = { letter: 'I', number: 18, order: 2, createdAt: new Date(now - 1000) }; // 1s ago

      prismaMock.calledNumber.findMany = jest.fn().mockResolvedValue([ball1, ball2]);

      // Evaluation on both balls: pattern completed, but NOT by ball2
      gameRuleEvaluationServiceMock.evaluate
        .mockReturnValueOnce({
          isWinner: true,
          completedByLatestNumber: false,
          matchedPattern: 'LINE_1',
          progress: 1,
          completedPatterns: [{ patternName: 'LINE_1', numbers: [5] }],
        })
        // Re-evaluation on ball 1 alone: pattern completed by ball 1!
        .mockReturnValueOnce({
          isWinner: true,
          completedByLatestNumber: true,
          matchedPattern: 'LINE_1',
          progress: 1,
          completedPatterns: [{ patternName: 'LINE_1', numbers: [5] }],
        });

      prismaMock.gameSession.updateMany = jest.fn().mockResolvedValue({ count: 1 });

      const result = await (service as any).createAutoValidatedClaim(
        prismaMock,
        baseCartelaRecord,
        'user-1',
        'FIVE_IN_A_ROW',
        {
          existingClaimId: 'claim-1',
          claimAttemptId: 'attempt-1',
          receivedAt: new Date(now),
          pausedRemainingMs: 0,
          hadScheduledAutoCall: false,
          autoCallAlreadyPaused: false,
        },
      );

      expect(result.kind).toBe('auto_valid_open');
      expect(result.response.isWinner).toBe(true);
      expect(result.response.gameStatus).toBe(GameStatus.WINNER_WINDOW);
    });

    it('rejects claim 3s after next ball as INVALID_LATE_CLAIM without blocking cartela (remains REGISTERED)', async () => {
      const now = Date.now();
      const ball1 = { letter: 'B', number: 5, order: 1, createdAt: new Date(now - 10_000) };
      const ball2 = { letter: 'I', number: 18, order: 2, createdAt: new Date(now - 3000) }; // 3s ago (>1.5s)

      prismaMock.calledNumber.findMany = jest.fn().mockResolvedValue([ball1, ball2]);

      gameRuleEvaluationServiceMock.evaluate.mockReturnValue({
        isWinner: true,
        completedByLatestNumber: false,
        matchedPattern: 'LINE_1',
        progress: 1,
        completedPatterns: [{ patternName: 'LINE_1', numbers: [5] }],
      });

      let updatedCartelaStatus: any = null;
      prismaMock.gameCartela.updateMany = jest.fn().mockImplementation((args: any) => {
        updatedCartelaStatus = args.data.status;
        return Promise.resolve({ count: 1 });
      });

      const result = await (service as any).createAutoValidatedClaim(
        prismaMock,
        baseCartelaRecord,
        'user-1',
        'FIVE_IN_A_ROW',
        {
          existingClaimId: 'claim-1',
          claimAttemptId: 'attempt-1',
          receivedAt: new Date(now),
          pausedRemainingMs: 0,
          hadScheduledAutoCall: false,
          autoCallAlreadyPaused: false,
        },
      );

      expect(result.kind).toBe('auto_invalid');
      expect(result.response.reasonCode).toBe('INVALID_LATE_CLAIM');
      expect(result.response.gameCartelaStatus).toBe(GameCartelaStatus.REGISTERED);
      expect(result.response.retryAllowed).toBe(true);
      // Cartela was NOT blocked in DB!
      expect(updatedCartelaStatus).not.toBe(GameCartelaStatus.BLOCKED);
    });

    it('blocks cartela only on INVALID_PATTERN (cartela becomes BLOCKED)', async () => {
      const now = Date.now();
      const ball1 = { letter: 'B', number: 5, order: 1, createdAt: new Date(now - 1000) };
      prismaMock.calledNumber.findMany = jest.fn().mockResolvedValue([ball1]);

      gameRuleEvaluationServiceMock.evaluate.mockReturnValue({
        isWinner: false,
        completedByLatestNumber: false,
        matchedPattern: '',
        progress: 0.5,
        completedPatterns: [],
      });

      let updatedCartelaStatus: any = null;
      prismaMock.gameCartela.updateMany = jest.fn().mockImplementation((args: any) => {
        updatedCartelaStatus = args.data.status;
        return Promise.resolve({ count: 1 });
      });

      const result = await (service as any).createAutoValidatedClaim(
        prismaMock,
        baseCartelaRecord,
        'user-1',
        'FIVE_IN_A_ROW',
        {
          existingClaimId: 'claim-1',
          claimAttemptId: 'attempt-1',
          receivedAt: new Date(now),
          pausedRemainingMs: 0,
          hadScheduledAutoCall: false,
          autoCallAlreadyPaused: false,
        },
      );

      expect(result.kind).toBe('auto_invalid');
      expect(result.response.reasonCode).toBe('INVALID_PATTERN');
      expect(result.response.gameCartelaStatus).toBe(GameCartelaStatus.BLOCKED);
      expect(result.response.retryAllowed).toBe(false);
      expect(updatedCartelaStatus).toBe(GameCartelaStatus.BLOCKED);
    });
  });

  describe('Task 6: Judge window by arrival time & prefetch timing config', () => {
    it('accepts join window claim when receivedAt is before deadline even if validation runs after deadline', async () => {
      const deadline = new Date(Date.now() - 500);
      const graceMs = 1000;
      const receivedBeforeDeadline = new Date(deadline.getTime() - 100);

      const gameCartela = {
        id: 'cartela-1',
        gameSessionId: 'session-1',
        userId: 'user-1',
        status: GameCartelaStatus.REGISTERED,
        isWinner: false,
        cartela: { id: 'c1', number: 12 },
        gameSession: {
          id: 'session-1',
          status: GameStatus.WINNER_WINDOW,
          winnerWindowEndsAt: deadline,
          autoCallEnabled: false,
          autoCallIntervalMs: 18000,
          gameSlot: { id: 'slot-1' },
        },
      };

      prismaMock.gameCartela.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prismaMock.bingoClaim.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prismaMock.bingoClaim.findUniqueOrThrow = jest.fn().mockResolvedValue({
        id: 'claim-1',
        claimAttemptId: 'attempt-1',
        userId: 'user-1',
        gameSessionId: 'session-1',
        gameCartelaId: 'cartela-1',
        status: 'VALID',
        attemptNumber: 1,
        rejectionReason: null,
        createdAt: new Date(),
        winningBallLetter: 'B',
        winningBallNumber: 5,
      });

      const result = await (service as any).createAutoValidJoinWindowClaim(
        prismaMock,
        gameCartela,
        'user-1',
        'LINE_1',
        [],
        graceMs,
        { letter: 'B', number: 5 },
        {
          existingClaimId: 'claim-1',
          claimAttemptId: 'attempt-1',
          receivedAt: receivedBeforeDeadline,
        },
      );

      expect(result.kind).toBe('auto_valid_join');
      expect(result.response.isWinner).toBe(true);
    });

    it('rejects claim right away in Tx1 without creating CHECKING row when arrival is after deadline + grace', async () => {
      const deadline = new Date(Date.now() - 5000);
      const graceMs = 1000;
      const receivedAfterGrace = new Date();

      const gameCartela = {
        id: 'cartela-1',
        gameSessionId: 'session-1',
        userId: 'user-1',
        status: GameCartelaStatus.REGISTERED,
        isWinner: false,
        cartela: { id: 'c1', number: 12, b: [], i: [], n: [], g: [], o: [] },
        gameSession: {
          id: 'session-1',
          playCode: 'PLAY-1',
          status: GameStatus.WINNER_WINDOW,
          prizeAmount: new Prisma.Decimal(100),
          winnerWindowEndsAt: deadline,
          autoCallEnabled: false,
          autoCallIntervalMs: 18000,
          nextAutoCallAt: null,
          roundIndex: 1,
          gameRule: { id: 'r1', key: 'FIVE_IN_A_ROW', name: 'Standard', patterns: [] },
          gameSlot: { id: 's1', gameType: 'REGULAR', gameRule: null },
        },
      };

      prismaMock.gameCartela.findUnique.mockResolvedValue(gameCartela);
      prismaMock.bingoClaim.findUnique.mockResolvedValue(null);
      prismaMock.bingoClaim.findFirst.mockResolvedValue(null);
      prismaMock.bingoClaim.create.mockResolvedValue({
        id: 'claim-failed-1',
        claimAttemptId: 'attempt-late-win',
        userId: 'user-1',
        gameSessionId: 'session-1',
        gameCartelaId: 'cartela-1',
        status: 'FAILED',
        failureCode: 'CLAIM_NOT_ELIGIBLE',
        attemptNumber: 1,
        rejectionReason: null,
        createdAt: new Date(),
      });

      const result = await (service as any).acceptClaimAttempt(prismaMock, {
        sessionId: 'session-1',
        userId: 'user-1',
        gameCartelaId: 'cartela-1',
        claimAttemptId: 'attempt-late-win',
        claimSource: 'MANUAL',
        clientTapAt: null,
        requestId: 'req-late',
        receivedAt: receivedAfterGrace,
        winnerWindowClaimGraceMs: graceMs,
      });

      expect(result.kind).toBe('business_rejected');
      expect(result.sideEffect.response.claim.status).toBe('FAILED');
      expect(result.sideEffect.response.retryAllowed).toBe(false);
      expect(result.sideEffect.response.failureCode).toBe('CLAIM_NOT_ELIGIBLE');
    });
  });

  describe('Task 7: Error code mapping and retry policy', () => {
    it('maps BadRequestException to CLAIM_NOT_ELIGIBLE instead of VALIDATION_INTERNAL_ERROR', () => {
      const mapped = (service as any).mapInfraFailureCode(
        new BadRequestException('Winner window has already closed'),
      );
      expect(mapped).toBe('CLAIM_NOT_ELIGIBLE');
    });

    it('sets retryAllowed to false for CLAIM_NOT_ELIGIBLE and AUTO_BINGO_NOT_ALLOWED', () => {
      const claimNotEligible: any = {
        status: 'FAILED',
        failureCode: 'CLAIM_NOT_ELIGIBLE',
      };
      const claimAutoNotAllowed: any = {
        status: 'FAILED',
        failureCode: 'AUTO_BINGO_NOT_ALLOWED',
      };
      const claimTimeout: any = {
        status: 'FAILED',
        failureCode: 'DB_TRANSACTION_TIMEOUT',
      };

      expect((service as any).isClaimRetryAllowed(claimNotEligible)).toBe(false);
      expect((service as any).isClaimRetryAllowed(claimAutoNotAllowed)).toBe(false);
      expect((service as any).isClaimRetryAllowed(claimTimeout)).toBe(true);
    });
  });
});
