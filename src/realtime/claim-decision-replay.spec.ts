import { BingoClaimStatus, GameStatus } from '@prisma/client';
import {
  buildClaimDecisionReplay,
  CLAIM_REPLAY_MAX_CLAIMS,
  ClaimReplayClaim,
  ClaimReplaySession,
  loadClaimDecisionReplay,
} from './claim-decision-replay';

const sessionId = '11111111-1111-4111-8111-111111111111';
const schedule = new Date('2026-11-13T10:00:30.000Z');

function session(
  overrides: Partial<ClaimReplaySession> = {},
): ClaimReplaySession {
  return {
    id: sessionId,
    status: GameStatus.PLAYING,
    autoCallEnabled: true,
    nextAutoCallAt: schedule,
    ...overrides,
  };
}

function claim(overrides: Partial<ClaimReplayClaim> = {}): ClaimReplayClaim {
  return {
    id: 'claim-1',
    claimAttemptId: 'attempt-1',
    userId: 'user-1',
    gameCartelaId: 'cartela-1',
    status: BingoClaimStatus.INVALID,
    checkedPattern: 'LINE',
    reason: 'Pattern not complete',
    reasonCode: 'INVALID_PATTERN',
    failureCode: null,
    receivedAt: new Date('2026-11-13T10:00:00.000Z'),
    cartelaNumber: 17,
    ...overrides,
  };
}

function build(
  claims: ClaimReplayClaim[],
  sessionOverrides: Partial<ClaimReplaySession> = {},
  roundStartedAfter: Date | null = null,
) {
  return buildClaimDecisionReplay({
    session: session(sessionOverrides),
    roundStartedAfter,
    claims,
  });
}

describe('buildClaimDecisionReplay', () => {
  it('replays INVALID with the live payload shape and the current schedule', () => {
    expect(build([claim()])).toEqual([
      {
        event: 'game:bingo_invalid',
        kind: 'invalid',
        claimId: 'claim-1',
        payload: {
          sessionId,
          userId: 'user-1',
          gameCartelaId: 'cartela-1',
          cartelaNumber: 17,
          claimId: 'claim-1',
          matchedPattern: 'LINE',
          reason: 'Pattern not complete',
          reasonCode: 'INVALID_PATTERN',
          progress: null,
          nextAutoCallAt: schedule.toISOString(),
        },
      },
    ]);
  });

  it('replays FAILED as checking (no nextAutoCallAt key) then claim_failed', () => {
    const events = build([
      claim({
        status: BingoClaimStatus.FAILED,
        reasonCode: null,
        failureCode: 'AUTO_BINGO_NOT_ALLOWED',
      }),
    ]);

    expect(events.map((item) => item.event)).toEqual([
      'game:bingo_checking',
      'game:bingo_claim_failed',
    ]);
    expect(events[0].payload).toEqual({
      sessionId,
      userId: 'user-1',
      gameCartelaId: 'cartela-1',
      claimAttemptId: 'attempt-1',
      cartelaNumber: 17,
    });
    expect('nextAutoCallAt' in events[0].payload).toBe(false);
    expect(events[1].payload).toEqual({
      sessionId,
      userId: 'user-1',
      gameCartelaId: 'cartela-1',
      cartelaNumber: 17,
      claimAttemptId: 'attempt-1',
      claimId: 'claim-1',
      retryAllowed: true,
      nextAutoCallAt: schedule.toISOString(),
      reasonCode: 'AUTO_BINGO_NOT_ALLOWED',
    });
  });

  it('replays an open CHECKING claim with nextAutoCallAt null, after decided claims', () => {
    const events = build([
      claim({
        id: 'claim-open',
        claimAttemptId: 'attempt-open',
        gameCartelaId: 'cartela-2',
        cartelaNumber: 42,
        status: BingoClaimStatus.CHECKING,
        receivedAt: new Date('2026-11-13T09:59:00.000Z'),
      }),
      claim(),
    ]);

    expect(events.map((item) => item.kind)).toEqual(['invalid', 'checking']);
    expect(events[1]).toEqual({
      event: 'game:bingo_checking',
      kind: 'checking',
      claimId: 'claim-open',
      payload: {
        sessionId,
        userId: 'user-1',
        gameCartelaId: 'cartela-2',
        claimAttemptId: 'attempt-open',
        cartelaNumber: 42,
        nextAutoCallAt: null,
      },
    });
  });

  it('only replays the open CHECKING claim when the same cartela also has FAILED rows', () => {
    const events = build([
      claim({
        id: 'claim-open',
        claimAttemptId: 'attempt-open',
        status: BingoClaimStatus.CHECKING,
        receivedAt: new Date('2026-11-13T10:00:00.000Z'),
      }),
      claim({
        id: 'claim-conflict',
        claimAttemptId: 'attempt-conflict',
        status: BingoClaimStatus.FAILED,
        failureCode: 'CLAIM_STATE_CONFLICT',
        receivedAt: new Date('2026-11-13T10:00:05.000Z'),
      }),
      claim({
        id: 'claim-old',
        claimAttemptId: 'attempt-old',
        status: BingoClaimStatus.FAILED,
        receivedAt: new Date('2026-11-13T09:58:00.000Z'),
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].claimId).toBe('claim-open');
    expect(events[0].kind).toBe('checking');
  });

  it('replays nothing for PENDING, VALID and ALREADY_RESOLVED claims', () => {
    expect(
      build([
        claim({ gameCartelaId: 'a', status: BingoClaimStatus.PENDING }),
        claim({ gameCartelaId: 'b', status: BingoClaimStatus.VALID }),
        claim({
          gameCartelaId: 'c',
          status: BingoClaimStatus.ALREADY_RESOLVED,
        }),
      ]),
    ).toEqual([]);
  });

  it('skips a cartela whose manual PENDING claim is still open', () => {
    expect(
      build([
        claim({ status: BingoClaimStatus.PENDING }),
        claim({
          id: 'claim-older',
          status: BingoClaimStatus.FAILED,
          receivedAt: new Date('2026-11-13T09:00:00.000Z'),
        }),
      ]),
    ).toEqual([]);
  });

  it('replays only the latest decided claim per cartela', () => {
    const events = build([
      claim({
        id: 'claim-old',
        status: BingoClaimStatus.FAILED,
        receivedAt: new Date('2026-11-13T09:00:00.000Z'),
      }),
      claim({
        id: 'claim-new',
        status: BingoClaimStatus.INVALID,
        receivedAt: new Date('2026-11-13T10:00:00.000Z'),
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].claimId).toBe('claim-new');
  });

  it('orders decided claims oldest first', () => {
    const events = build([
      claim({
        id: 'claim-late',
        gameCartelaId: 'a',
        receivedAt: new Date('2026-11-13T10:05:00.000Z'),
      }),
      claim({
        id: 'claim-early',
        gameCartelaId: 'b',
        receivedAt: new Date('2026-11-13T10:01:00.000Z'),
      }),
    ]);

    expect(events.map((item) => item.claimId)).toEqual([
      'claim-early',
      'claim-late',
    ]);
  });

  it('returns nothing when the session is not PLAYING', () => {
    for (const status of [
      GameStatus.WINNER_WINDOW,
      GameStatus.FINISHED,
      GameStatus.NO_WINNER,
      GameStatus.READY,
    ]) {
      expect(build([claim()], { status })).toEqual([]);
    }
  });

  it('excludes claims from previous chain rounds', () => {
    const roundStartedAfter = new Date('2026-11-13T10:00:00.000Z');
    expect(
      build(
        [claim({ receivedAt: new Date('2026-11-13T09:59:59.000Z') })],
        {},
        roundStartedAfter,
      ),
    ).toEqual([]);
    expect(
      build(
        [claim({ receivedAt: new Date('2026-11-13T10:00:01.000Z') })],
        {},
        roundStartedAfter,
      ),
    ).toHaveLength(1);
  });

  it('sends nextAutoCallAt null when auto-call is off or unscheduled', () => {
    expect(
      build([claim()], { autoCallEnabled: false })[0].payload.nextAutoCallAt,
    ).toBeNull();
    expect(
      build([claim()], { nextAutoCallAt: null })[0].payload.nextAutoCallAt,
    ).toBeNull();
  });
});

describe('loadClaimDecisionReplay', () => {
  function prismaMock(sessionRow: unknown, claimRows: unknown[] = []) {
    return {
      gameSession: { findUnique: jest.fn().mockResolvedValue(sessionRow) },
      bingoClaim: { findMany: jest.fn().mockResolvedValue(claimRows) },
    };
  }

  const claimRow = {
    id: 'claim-1',
    claimAttemptId: 'attempt-1',
    userId: 'user-1',
    gameCartelaId: 'cartela-1',
    status: BingoClaimStatus.INVALID,
    checkedPattern: 'LINE',
    reason: 'Pattern not complete',
    reasonCode: 'INVALID_PATTERN',
    failureCode: null,
    receivedAt: new Date('2026-11-13T10:00:00.000Z'),
    gameCartela: { cartela: { number: 17 } },
  };

  it('does not query claims when the session is missing or not PLAYING', async () => {
    for (const row of [
      null,
      { ...session(), status: GameStatus.FINISHED, roundResults: [] },
    ]) {
      const prisma = prismaMock(row);
      await expect(
        loadClaimDecisionReplay(prisma as any, sessionId),
      ).resolves.toEqual([]);
      expect(prisma.bingoClaim.findMany).not.toHaveBeenCalled();
    }
  });

  it('limits the query to the current round and the replay cap', async () => {
    const finalizedAt = new Date('2026-11-13T09:30:00.000Z');
    const prisma = prismaMock(
      { ...session(), roundResults: [{ finalizedAt }] },
      [claimRow],
    );

    const events = await loadClaimDecisionReplay(prisma as any, sessionId);

    expect(prisma.bingoClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { gameSessionId: sessionId, receivedAt: { gt: finalizedAt } },
        orderBy: { receivedAt: 'desc' },
        take: CLAIM_REPLAY_MAX_CLAIMS,
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload.cartelaNumber).toBe(17);
  });

  it('queries the whole session when no round has finished yet', async () => {
    const prisma = prismaMock({ ...session(), roundResults: [] }, []);

    await loadClaimDecisionReplay(prisma as any, sessionId);

    expect(prisma.bingoClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { gameSessionId: sessionId } }),
    );
  });
});
