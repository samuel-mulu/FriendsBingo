import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GameCartelaStatus, GameStatus, Prisma } from '@prisma/client';
import { BingoClaimsService } from './bingo-claims.service';

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

  beforeEach(() => {
    prismaMock = {
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(prismaMock)),
      gameCartela: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
      },
      gameSession: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
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

    service = new BingoClaimsService(
      prismaMock,
      gameEngineServiceMock,
      gameRuleEvaluationServiceMock,
      realtimeServiceMock,
      auditLogServiceMock,
      walletServiceMock,
      gameQueueServiceMock,
      requestPerformanceMock,
      gameTimingConfigServiceMock,
      operationsCacheServiceMock,
      postGameRegistrationOpenerServiceMock,
      gamePushNotificationsServiceMock,
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
        gameCartelas: [
          { id: 'cartela-1', userId: 'user-1' },
          { id: 'cartela-2', userId: 'user-2' },
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
  });
});
