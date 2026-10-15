import {
  BingoClaimStatus,
  GameCartelaStatus,
  GameStatus,
} from '@prisma/client';
import { BingoClaimsService } from './bingo-claims.service';
import { BingoClaimSource } from './dto/bingo-claim-source';
import { GameRuleEvaluationService } from '../game-rules/game-rule-evaluation.service';

describe('BingoClaimsService Auto Bingo authorization (A6.1)', () => {
  const sessionId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const gameCartelaId = '33333333-3333-3333-3333-333333333333';
  const claimAttemptId = '55555555-5555-5555-5555-555555555555';
  const claimId = '44444444-4444-4444-4444-444444444444';

  const auditCreate = jest.fn(async () => undefined);

  function registeredCartela(ruleKey = 'ONE_LINE') {
    return {
      id: gameCartelaId,
      gameSessionId: sessionId,
      userId,
      status: GameCartelaStatus.REGISTERED,
      isWinner: false,
      cartela: {
        id: 'c1',
        number: 12,
        b: [],
        i: [],
        n: [],
        g: [],
        o: [],
      },
      gameSession: {
        id: sessionId,
        playCode: 'BINGO-1',
        status: GameStatus.PLAYING,
        prizeAmount: { toString: () => '100' },
        autoCallEnabled: false,
        autoCallIntervalMs: 3000,
        nextAutoCallAt: null,
        winnerWindowEndsAt: null,
        roundIndex: 1,
        gameRule: {
          id: 'r1',
          key: ruleKey,
          name: ruleKey,
          patterns: null,
        },
        gameSlot: {
          id: 'slot-1',
          gameType: ruleKey,
          gameRule: {
            id: 'r1',
            key: ruleKey,
            name: ruleKey,
            patterns: null,
          },
        },
      },
    };
  }

  function buildTx(options: {
    ruleKey?: string;
    autoBingoGranted?: boolean;
    autoBingoEnabled?: boolean;
    openChecking?: { claimAttemptId: string } | null;
  }) {
    const ruleKey = options.ruleKey ?? 'ONE_LINE';
    const cartela = registeredCartela(ruleKey);
    const createdClaims: Array<Record<string, unknown>> = [];

    const tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join(' ');
        if (sql.includes('"GameSession"')) {
          return [{ id: sessionId }];
        }
        if (sql.includes('"User"')) {
          return [{ id: userId }];
        }
        return [];
      }),
      gameCartela: {
        findFirst: jest.fn(async () => cartela),
      },
      bingoClaim: {
        findFirst: jest.fn(async () => options.openChecking ?? null),
        findUnique: jest.fn(async () => null),
        count: jest.fn(async () => 0),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: claimId,
            claimAttemptId: data.claimAttemptId,
            gameSessionId: data.gameSessionId,
            userId: data.userId,
            gameCartelaId: data.gameCartelaId,
            status: data.status,
            attemptNumber: data.attemptNumber ?? 1,
            checkedPattern: data.checkedPattern ?? ruleKey,
            reason: data.reason ?? null,
            reasonCode: data.reasonCode ?? null,
            failureCode: data.failureCode ?? null,
            failureMessage: data.failureMessage ?? null,
            winningBallLetter: null,
            winningBallNumber: null,
            receiptBallLetter: data.receiptBallLetter ?? null,
            receiptBallNumber: data.receiptBallNumber ?? null,
            receiptCalledOrder: data.receiptCalledOrder ?? null,
            calledNumbersCountAtReceipt:
              data.calledNumbersCountAtReceipt ?? null,
            receivedAt: data.receivedAt ?? new Date(),
            completedAt: data.completedAt ?? null,
            durationMs: data.durationMs ?? null,
            requestId: data.requestId ?? 'req-test',
            clientTapAt: data.clientTapAt ?? null,
            createdAt: new Date(),
            checkedAt: data.checkedAt ?? null,
          };
          createdClaims.push(row);
          return row;
        }),
      },
      calledNumber: {
        findFirst: jest.fn(async () => ({
          letter: 'N',
          number: 38,
          order: 12,
        })),
        count: jest.fn(async () => 12),
      },
      user: {
        findUnique: jest.fn(async () => ({
          autoBingoGranted: options.autoBingoGranted ?? false,
          autoBingoEnabled: options.autoBingoEnabled ?? false,
        })),
      },
      gameSession: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        update: jest.fn(async () => ({})),
      },
    };

    return { tx, cartela, createdClaims };
  }

  function buildService() {
    const ruleEval = new GameRuleEvaluationService();
    return new BingoClaimsService(
      {} as never,
      {} as never,
      ruleEval,
      {
        emitToGame: jest.fn(),
        emitToAdmin: jest.fn(),
        emitToUser: jest.fn(),
        emitToPublicGames: jest.fn(),
        emitGameOperationUpdate: jest.fn(),
      } as never,
      { create: auditCreate } as never,
      {} as never,
      {} as never,
      {
        run: jest.fn((_ctx: unknown, fn: () => Promise<unknown>) => fn()),
      } as never,
      {} as never,
      { invalidate: jest.fn() } as never,
      {} as never,
      { notifyWinnerWindowStarted: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      { getRequestIdForLog: jest.fn(() => 'req-test') } as never,
    );
  }

  async function accept(
    service: BingoClaimsService,
    tx: unknown,
    claimSource: BingoClaimSource,
  ) {
    return (service as unknown as {
      acceptClaimAttempt: (
        tx: unknown,
        args: Record<string, unknown>,
      ) => Promise<{ kind: string; sideEffect?: { response: Record<string, unknown> }; claimId?: string }>;
    }).acceptClaimAttempt(tx, {
      sessionId,
      userId,
      gameCartelaId,
      claimAttemptId,
      claimSource,
      clientTapAt: null,
      requestId: 'req-test',
    });
  }

  beforeEach(() => {
    auditCreate.mockClear();
  });

  it('rejects AUTO without grant', async () => {
    const { tx, createdClaims } = buildTx({
      autoBingoGranted: false,
      autoBingoEnabled: true,
    });
    const result = await accept(buildService(), tx, BingoClaimSource.AUTO);

    expect(result.kind).toBe('business_rejected');
    expect(result.sideEffect?.response.failureCode).toBe(
      'AUTO_BINGO_NOT_ALLOWED',
    );
    expect(createdClaims[0]?.status).toBe(BingoClaimStatus.FAILED);
    expect(tx.user.findUnique).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'player.bingo.rejected',
        metadata: expect.objectContaining({
          claimSource: BingoClaimSource.AUTO,
          failureCode: 'AUTO_BINGO_NOT_ALLOWED',
        }),
      }),
    );
  });

  it('rejects AUTO when granted but disabled', async () => {
    const { tx } = buildTx({
      autoBingoGranted: true,
      autoBingoEnabled: false,
    });
    const result = await accept(buildService(), tx, BingoClaimSource.AUTO);

    expect(result.kind).toBe('business_rejected');
    expect(result.sideEffect?.response.failureCode).toBe(
      'AUTO_BINGO_NOT_ALLOWED',
    );
  });

  it('accepts AUTO when granted and enabled', async () => {
    const { tx, createdClaims } = buildTx({
      autoBingoGranted: true,
      autoBingoEnabled: true,
    });
    const result = await accept(buildService(), tx, BingoClaimSource.AUTO);

    expect(result.kind).toBe('auto_checking');
    expect(result.claimId).toBe(claimId);
    expect(createdClaims[0]?.status).toBe(BingoClaimStatus.CHECKING);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'player.bingo.checking',
        metadata: expect.objectContaining({
          claimSource: BingoClaimSource.AUTO,
        }),
      }),
    );
  });

  it('accepts MANUAL without feature grant', async () => {
    const { tx, createdClaims } = buildTx({
      autoBingoGranted: false,
      autoBingoEnabled: false,
    });
    const result = await accept(buildService(), tx, BingoClaimSource.MANUAL);

    expect(result.kind).toBe('auto_checking');
    expect(createdClaims[0]?.status).toBe(BingoClaimStatus.CHECKING);
    expect(tx.user.findUnique).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'player.bingo.checking',
        metadata: expect.objectContaining({
          claimSource: BingoClaimSource.MANUAL,
        }),
      }),
    );
  });

  it('rejects AUTO for MANUAL rule mode while MANUAL claim still works', async () => {
    const autoTx = buildTx({
      ruleKey: 'MANUAL',
      autoBingoGranted: true,
      autoBingoEnabled: true,
    });
    const autoResult = await accept(
      buildService(),
      autoTx.tx,
      BingoClaimSource.AUTO,
    );
    expect(autoResult.kind).toBe('business_rejected');
    expect(autoResult.sideEffect?.response.failureCode).toBe(
      'AUTO_BINGO_NOT_ALLOWED',
    );
    // AUTO rejected before user lock for MANUAL rules.
    expect(autoTx.tx.user.findUnique).not.toHaveBeenCalled();

    const manualTx = buildTx({
      ruleKey: 'MANUAL',
      autoBingoGranted: false,
      autoBingoEnabled: false,
    });
    const manualResult = await accept(
      buildService(),
      manualTx.tx,
      BingoClaimSource.MANUAL,
    );
    expect(manualResult.kind).toBe('manual_pending');
  });

  it('revoke-before-accept: User lock sees disabled Auto Bingo', async () => {
    const { tx } = buildTx({
      autoBingoGranted: false,
      autoBingoEnabled: false,
    });
    // Simulate post-revoke row under FOR UPDATE.
    tx.user.findUnique.mockResolvedValue({
      autoBingoGranted: false,
      autoBingoEnabled: false,
    });

    const result = await accept(buildService(), tx, BingoClaimSource.AUTO);
    expect(result.kind).toBe('business_rejected');
    expect(result.sideEffect?.response.failureCode).toBe(
      'AUTO_BINGO_NOT_ALLOWED',
    );
  });

  it('claimBingo idempotent hit skips accept for repeated claimAttemptId', async () => {
    const existing = {
      id: claimId,
      claimAttemptId,
      gameSessionId: sessionId,
      userId,
      gameCartelaId,
      status: BingoClaimStatus.FAILED,
      attemptNumber: 1,
      checkedPattern: 'ONE_LINE',
      reason: 'Auto Bingo is not enabled for this account',
      reasonCode: null,
      failureCode: 'AUTO_BINGO_NOT_ALLOWED',
      failureMessage: 'Auto Bingo is not enabled for this account',
      winningBallLetter: null,
      winningBallNumber: null,
      receiptBallLetter: null,
      receiptBallNumber: null,
      receiptCalledOrder: null,
      calledNumbersCountAtReceipt: null,
      receivedAt: new Date(),
      completedAt: new Date(),
      durationMs: 0,
      requestId: 'req-test',
      clientTapAt: null,
      createdAt: new Date(),
      checkedAt: new Date(),
    };

    const prisma = {
      bingoClaim: {
        findUnique: jest.fn(async () => existing),
      },
      gameCartela: {
        findUnique: jest.fn(async () => ({
          status: GameCartelaStatus.REGISTERED,
          isWinner: false,
          gameSession: {
            status: GameStatus.PLAYING,
            nextAutoCallAt: null,
            winnerWindowEndsAt: null,
          },
        })),
      },
      $transaction: jest.fn(),
    };

    const service = new BingoClaimsService(
      prisma as never,
      {} as never,
      new GameRuleEvaluationService(),
      {
        emitToGame: jest.fn(),
        emitToAdmin: jest.fn(),
        emitToUser: jest.fn(),
        emitToPublicGames: jest.fn(),
        emitGameOperationUpdate: jest.fn(),
      } as never,
      { create: auditCreate } as never,
      {} as never,
      {} as never,
      {
        run: jest.fn((_ctx: unknown, fn: () => Promise<unknown>) => fn()),
      } as never,
      {} as never,
      { invalidate: jest.fn() } as never,
      {} as never,
      { notifyWinnerWindowStarted: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      { getRequestIdForLog: jest.fn(() => 'req-test') } as never,
    );

    const response = await service.claimBingo(sessionId, userId, {
      gameCartelaId,
      claimAttemptId,
      claimSource: BingoClaimSource.AUTO,
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      failureCode: 'AUTO_BINGO_NOT_ALLOWED',
      claim: expect.objectContaining({ claimAttemptId }),
    });
  });

  it('createAutoValidatedClaim is not invoked with a second Auto Bingo grant check', () => {
    // Contract: revoke-after-accept must not cancel validation — grant is
    // only read in acceptClaimAttempt under User FOR UPDATE.
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const source = fs.readFileSync(
      path.join(__dirname, 'bingo-claims.service.ts'),
      'utf8',
    );
    const validateFn = source.slice(
      source.indexOf('private async createAutoValidatedClaim'),
      source.indexOf('private serializeCartelaCompletedPatterns'),
    );
    expect(validateFn).not.toContain('autoBingoGranted');
    expect(validateFn).not.toContain('effectiveAutoBingo');
    expect(validateFn).not.toContain('lockUserRow');
    expect(validateFn).toContain('gameRuleEvaluationService.evaluate');
  });
});
