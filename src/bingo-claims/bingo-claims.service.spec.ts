import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  BingoClaimStatus,
  GameCartelaStatus,
  GameStatus,
  Prisma,
  WalletTransactionType,
} from '@prisma/client';
import { RequestPerformanceContext } from '../common/performance/request-performance.context';
import { BingoClaimsService } from './bingo-claims.service';

describe('BingoClaimsService', () => {
  const now = new Date('2026-06-06T18:00:00.000Z');

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  function createClaimRecord(overrides?: Record<string, unknown>) {
    return {
      id: 'claim-1',
      gameSessionId: 'session-1',
      userId: 'user-1',
      gameCartelaId: 'gc-1',
      status: BingoClaimStatus.PENDING,
      checkedPattern: 'MANUAL',
      reason: 'Waiting for admin confirmation',
      reasonCode: null,
      createdAt: now,
      checkedAt: null,
      user: {
        id: 'user-1',
        fullName: 'Player One',
        phoneNumber: '0912345678',
      },
      gameSession: {
        id: 'session-1',
        playCode: 'BINGO-ABC123',
        status: GameStatus.CHECKING,
        prizeAmount: new Prisma.Decimal('80'),
        gameSlot: {
          id: 'slot-1',
          gameType: 'MANUAL',
          name: 'Manual',
          gameRule: {
            id: 'rule-1',
            key: 'MANUAL',
            name: 'Manual',
          },
        },
      },
      gameCartela: {
        id: 'gc-1',
        status: GameCartelaStatus.REGISTERED,
        isWinner: false,
        blockedAt: null,
        cartela: {
          id: 'cartela-1',
          number: 7,
        },
      },
      ...overrides,
    };
  }

  function createSessionRecord(overrides?: Record<string, unknown>) {
    return {
      id: 'session-1',
      gameSlotId: 'slot-1',
      playCode: 'BINGO-ABC123',
      entryFee: new Prisma.Decimal('10'),
      prizePerCartela: new Prisma.Decimal('8'),
      companyFeePerCartela: new Prisma.Decimal('2'),
      prizeAmount: new Prisma.Decimal('80'),
      companyRevenue: new Prisma.Decimal('20'),
      status: GameStatus.FINISHED,
      startedAt: new Date('2026-06-06T17:00:00.000Z'),
      finishedAt: now,
      winnerCartelaId: 'gc-1',
      createdAt: new Date('2026-06-06T17:00:00.000Z'),
      updatedAt: now,
      gameSlot: {
        id: 'slot-1',
        staticCode: 'MANUAL-S1',
        name: 'Manual',
        gameType: 'MANUAL',
        gameRuleId: 'rule-1',
        status: GameStatus.NEXT,
        entryFee: new Prisma.Decimal('10'),
        prizePerCartela: new Prisma.Decimal('8'),
        sortOrder: 5,
        createdAt: new Date('2026-06-06T16:00:00.000Z'),
        updatedAt: now,
        gameRule: {
          id: 'rule-1',
          key: 'MANUAL',
          name: 'Manual',
          description: null,
          isActive: true,
          sortOrder: 1,
        },
      },
      _count: {
        gameCartelas: 10,
        calledNumbers: 25,
      },
      ...overrides,
    };
  }

  function createService(overrides?: {
    playerCartela?: Record<string, unknown> | null;
    existingPendingClaim?: Record<string, unknown> | null;
    claimRecord?: Record<string, unknown> | null;
    finishGameWithWinner?: boolean;
    updatedSession?: Record<string, unknown> | null;
  }) {
    const playerCartela = overrides?.playerCartela ?? {
      id: 'gc-1',
      gameSessionId: 'session-1',
      userId: 'user-1',
      status: GameCartelaStatus.REGISTERED,
      isWinner: false,
      cartela: {
        id: 'cartela-1',
        number: 7,
      },
      gameSession: {
        id: 'session-1',
        playCode: 'BINGO-ABC123',
        status: GameStatus.PLAYING,
        gameSlot: {
          id: 'slot-1',
          gameType: 'MANUAL',
          gameRule: {
            id: 'rule-1',
            key: 'MANUAL',
            name: 'Manual',
          },
        },
      },
    };

    const pendingClaim = createClaimRecord(overrides?.claimRecord ?? undefined);

    const tx = {
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue(playerCartela),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      gameSession: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      bingoClaim: {
        findFirst: jest
          .fn()
          .mockResolvedValue(overrides?.existingPendingClaim ?? null),
        findUnique: jest
          .fn()
          .mockResolvedValue(
            overrides?.claimRecord === null ? null : pendingClaim,
          ),
        create: jest.fn().mockImplementation(async ({ data }) =>
          createClaimRecord({
            gameSessionId: data.gameSessionId,
            userId: data.userId,
            gameCartelaId: data.gameCartelaId,
            status: data.status,
            checkedPattern: data.checkedPattern,
            reason: data.reason,
            reasonCode: data.reasonCode ?? null,
          }),
        ),
        update: jest.fn().mockImplementation(async ({ data }) =>
          createClaimRecord({
            status: data.status,
            reason: data.reason ?? null,
            reasonCode: data.reasonCode ?? null,
            checkedAt: data.checkedAt ?? now,
          }),
        ),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'gc-1',
          status: GameCartelaStatus.REGISTERED,
          isWinner: false,
          cartela: { number: 7 },
        }),
      },
      gameSession: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            overrides?.updatedSession === null
              ? null
              : createSessionRecord(overrides?.updatedSession ?? undefined),
          ),
      },
      gameSlot: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'slot-1',
          staticCode: 'MANUAL-S1',
          name: 'Manual',
          gameType: 'MANUAL',
          gameRuleId: 'rule-1',
          status: GameStatus.NEXT,
          entryFee: new Prisma.Decimal('10'),
          prizePerCartela: new Prisma.Decimal('8'),
          sortOrder: 5,
          sessions: [
            {
              id: 'session-1',
              status: GameStatus.PLAYING,
              playCode: 'BINGO-TEST',
              entryFee: new Prisma.Decimal('10'),
              prizePerCartela: new Prisma.Decimal('8'),
              companyFeePerCartela: new Prisma.Decimal('2'),
              prizeAmount: new Prisma.Decimal('80'),
              companyRevenue: new Prisma.Decimal('20'),
              startedAt: new Date(),
              _count: {
                gameCartelas: 10,
                calledNumbers: 25,
              },
            },
          ],
          gameRule: {
            id: 'rule-1',
            key: 'MANUAL',
            name: 'Manual',
            description: null,
            isActive: true,
            sortOrder: 1,
          },
        }),
      },
    };

    const gameEngineService = {
      finishGameWithWinner: jest
        .fn()
        .mockResolvedValue(overrides?.finishGameWithWinner ?? true),
      emitSessionFinished: jest.fn().mockResolvedValue(undefined),
    };

    const realtimeService = {
      emitToGame: jest.fn(),
      emitToAdmin: jest.fn(),
      emitToUser: jest.fn(),
      emitToPublicGames: jest.fn(),
      emitGameFinished: jest.fn(),
      emitGameOperationUpdate: jest.fn(),
    };

    const walletService = {
      creditWallet: jest.fn().mockResolvedValue(undefined),
      getSerializedWallet: jest.fn().mockResolvedValue({
        id: 'wallet-1',
        userId: 'user-1',
        balance: '180.00',
        lockedBalance: '0.00',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }),
    };

    const gameRuleEvaluationService = {
      isManualRule: jest.fn().mockReturnValue(true),
      evaluate: jest.fn(),
    };

    return {
      service: new BingoClaimsService(
        prisma as never,
        gameEngineService as never,
        gameRuleEvaluationService as never,
        realtimeService as never,
        { create: jest.fn() } as never,
        walletService as never,
        { moveSlotToBack: jest.fn() } as never,
        new RequestPerformanceContext(),
        {
          getAutoCallIntervalMs: jest.fn().mockResolvedValue(7000),
          getWinnerWindowDurationMs: jest.fn().mockResolvedValue(15_000),
          getWinnerWindowClaimGraceMs: jest.fn().mockResolvedValue(750),
        } as never,
        { invalidate: jest.fn() } as never,
      ),
      tx,
      gameEngineService,
      realtimeService,
      walletService,
    };
  }

  it('creates a pending bingo claim and moves the session to CHECKING', async () => {
    const { service, tx, walletService } = createService();

    const result = await service.claimBingo('session-1', 'user-1', 'gc-1');

    expect(tx.bingoClaim.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BingoClaimStatus.PENDING,
          reasonCode: null,
        }),
      }),
    );
    expect(tx.gameSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: {
        status: GameStatus.CHECKING,
        autoCallEnabled: false,
        nextAutoCallAt: null,
      },
    });
    expect(result.claim.status).toBe(BingoClaimStatus.PENDING);
    expect(walletService.creditWallet).not.toHaveBeenCalled();
  });

  it('approves a pending claim and pays the session prize once', async () => {
    const { service, tx, gameEngineService, walletService } = createService();

    const result = await service.approveClaim('claim-1', 'admin-1');

    expect(gameEngineService.finishGameWithWinner).toHaveBeenCalledWith(
      tx,
      'session-1',
      'gc-1',
      now,
    );
    expect(walletService.creditWallet).toHaveBeenCalledWith(
      tx,
      'user-1',
      expect.any(Prisma.Decimal),
      {
        type: WalletTransactionType.PRIZE_WIN,
        referenceType: 'GAME_CARTELA',
        referenceId: 'gc-1',
        description: 'Prize win for session BINGO-ABC123',
      },
    );
    expect(walletService.creditWallet).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(BingoClaimStatus.VALID);
    expect(result.reasonCode).toBeNull();
    expect(gameEngineService.emitSessionFinished).toHaveBeenCalledWith(
      'session-1',
    );
  });

  it('rejects a pending claim, blocks the cartela, and returns the session to PLAYING', async () => {
    const { service, tx, walletService, realtimeService } = createService();

    const result = await service.rejectClaim(
      'claim-1',
      { reason: 'Numbers did not match' },
      'admin-1',
    );

    expect(tx.gameCartela.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: GameCartelaStatus.BLOCKED,
        }),
      }),
    );
    expect(tx.gameSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { status: GameStatus.PLAYING },
    });
    expect(result.status).toBe(BingoClaimStatus.INVALID);
    expect(result.reason).toBe('Numbers did not match');
    expect(result.reasonCode).toBeNull();
    expect(walletService.creditWallet).not.toHaveBeenCalled();
    expect(realtimeService.emitToGame).toHaveBeenCalledWith(
      'session-1',
      'game:bingo_invalid',
      expect.objectContaining({
        claimId: 'claim-1',
      }),
    );
  });

  it('does not pay when the session is already finished', async () => {
    const { service, walletService } = createService({
      claimRecord: {
        gameSession: {
          ...createClaimRecord().gameSession,
          status: GameStatus.FINISHED,
        },
      },
    });

    await expect(
      service.approveClaim('claim-1', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(walletService.creditWallet).not.toHaveBeenCalled();
  });

  it('only pays one winner when another approval already finished the session', async () => {
    const { service, walletService } = createService({
      finishGameWithWinner: false,
    });

    await expect(
      service.approveClaim('claim-1', 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(walletService.creditWallet).not.toHaveBeenCalled();
  });
});
