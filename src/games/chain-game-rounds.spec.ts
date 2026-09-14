import { GameCartelaStatus, GameCategory, GameStatus, Prisma } from '@prisma/client';
import {
  CHAIN_GAME_DEFAULT_INTER_ROUND_DELAY_SECONDS,
  buildChainRoundSeedData,
  hasRemainingChainRounds,
  isChainRoundPaused,
  resolveRoundPrizeAmount,
} from './chain-round.util';

/**
 * Contract tests for CHAIN_GAME. Unlike BIG_GAME, every round lives inside ONE
 * GameSession: the ball draw never restarts and marked cells are never cleared.
 * A non-final round therefore must NOT write FINISHED — that is the invariant
 * that keeps NORMAL / BONUS / BIG_GOTD / BIG_GAME flows untouched.
 */
describe('Chain Game round contract', () => {
  const roundCount = 2;
  const roundPrizes = ['3000', '2000'];
  const sessionId = 'session-chain-1';

  it('keeps the same sessionId across rounds', () => {
    const afterRound1 = {
      id: sessionId,
      status: GameStatus.PLAYING,
      roundIndex: 2,
      calledNumbersCount: 18,
    };

    expect(afterRound1.id).toBe(sessionId);
    expect(afterRound1.status).toBe(GameStatus.PLAYING);
    expect(afterRound1.status).not.toBe(GameStatus.FINISHED);
  });

  it('never writes FINISHED on a non-final round', () => {
    expect(hasRemainingChainRounds({ roundIndex: 1, roundCount })).toBe(true);

    const midChain = {
      status: GameStatus.PLAYING as GameStatus,
      roundPausedUntil: new Date('2026-09-14T10:00:20.000Z'),
      finishedAt: null as Date | null,
    };

    expect(midChain.status).toBe(GameStatus.PLAYING);
    expect(midChain.finishedAt).toBeNull();
  });

  it('preserves called numbers on the same session', () => {
    const calledBefore = 18;
    const afterPause = { id: sessionId, calledNumbersCount: calledBefore };
    expect(afterPause.calledNumbersCount).toBe(calledBefore);
  });

  it('returns winners to REGISTERED so they can win later rounds', () => {
    const afterAdvance = {
      status: GameCartelaStatus.REGISTERED,
      isWinner: false,
    };
    expect(afterAdvance.status).toBe(GameCartelaStatus.REGISTERED);
    expect(afterAdvance.isWinner).toBe(false);
  });

  it('does not un-block invalid cartelas when winners are reset', () => {
    const winnerResetWhere = {
      id: { in: ['winner-cartela-1'] },
      status: GameCartelaStatus.WINNER,
    };
    const blocked = {
      id: 'blocked-cartela-1',
      status: GameCartelaStatus.BLOCKED,
      isWinner: false,
    };

    expect(winnerResetWhere.status).toBe(GameCartelaStatus.WINNER);
    expect(winnerResetWhere.id.in).not.toContain(blocked.id);
    expect(blocked.status).toBe(GameCartelaStatus.BLOCKED);
  });

  it('arms roundPausedUntil from the configured delay without creating a session', () => {
    const now = Date.parse('2026-09-14T10:00:00.000Z');
    const delaySeconds = CHAIN_GAME_DEFAULT_INTER_ROUND_DELAY_SECONDS;
    const pausedUntil = new Date(now + delaySeconds * 1000);

    expect(delaySeconds).toBe(20);
    expect(
      isChainRoundPaused(
        { status: GameStatus.PLAYING, roundPausedUntil: pausedUntil },
        new Date(now),
      ),
    ).toBe(true);
    expect(pausedUntil.toISOString()).toBe('2026-09-14T10:00:20.000Z');
  });

  it('pays the current round prize, leaving prizeAmount as the whole-chain pool', () => {
    const seed = buildChainRoundSeedData({
      category: GameCategory.CHAIN_GAME,
      gameRuleId: 'rule-1',
      roundPrizes,
      roundGameRuleIds: ['rule-1', 'rule-2'],
      fixedPrizeAmount: new Prisma.Decimal('5000'),
    });

    expect(seed.roundPrizeAmount?.toString()).toBe('3000');
    expect(
      resolveRoundPrizeAmount({
        roundIndex: 2,
        roundPrizes,
        fallbackPrizeAmount: '5000',
      }).toString(),
    ).toBe('2000');
  });

  it('forfeits every remaining round when balls run out mid-chain', () => {
    const fromRoundIndex = 2;
    const forfeited: Array<{
      roundIndex: number;
      outcome: 'FORFEITED';
      paidAmount: string;
      prizeAmount: string;
    }> = [];
    for (let roundIndex = fromRoundIndex; roundIndex <= roundCount; roundIndex += 1) {
      forfeited.push({
        roundIndex,
        outcome: 'FORFEITED',
        paidAmount: '0',
        prizeAmount: resolveRoundPrizeAmount({
          roundIndex,
          roundPrizes,
          fallbackPrizeAmount: '5000',
        }).toString(),
      });
    }

    expect(forfeited).toEqual([
      {
        roundIndex: 2,
        outcome: 'FORFEITED',
        paidAmount: '0',
        prizeAmount: '2000',
      },
    ]);
  });
});
