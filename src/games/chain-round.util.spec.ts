import { GameCategory, GameStatus, Prisma } from '@prisma/client';
import { splitPrizeAmount } from '../bingo-claims/prize-split.util';
import {
  buildChainRoundSeedData,
  hasRemainingChainRounds,
  isChainRoundPaused,
  resolveRoundPrizeAmount,
} from './chain-round.util';

describe('chain-round.util', () => {
  it('resolves the per-round prize and falls back to the pool', () => {
    expect(
      resolveRoundPrizeAmount({
        roundIndex: 2,
        roundPrizes: ['3000', '2000'],
        fallbackPrizeAmount: '5000',
      }).toString(),
    ).toBe('2000');

    expect(
      resolveRoundPrizeAmount({
        roundIndex: 1,
        roundPrizes: null,
        fallbackPrizeAmount: '5000',
      }).toString(),
    ).toBe('5000');
  });

  it('knows a non-final round must continue on the same session', () => {
    expect(hasRemainingChainRounds({ roundIndex: 1, roundCount: 2 })).toBe(
      true,
    );
    expect(hasRemainingChainRounds({ roundIndex: 2, roundCount: 2 })).toBe(
      false,
    );
  });

  it('treats a future roundPausedUntil on a PLAYING session as paused', () => {
    const now = new Date('2026-09-14T10:00:00.000Z');
    expect(
      isChainRoundPaused(
        {
          status: GameStatus.PLAYING,
          roundPausedUntil: new Date('2026-09-14T10:00:20.000Z'),
        },
        now,
      ),
    ).toBe(true);
    expect(
      isChainRoundPaused(
        {
          status: GameStatus.PLAYING,
          roundPausedUntil: new Date('2026-09-14T09:59:59.000Z'),
        },
        now,
      ),
    ).toBe(false);
    expect(
      isChainRoundPaused(
        {
          status: GameStatus.FINISHED,
          roundPausedUntil: new Date('2026-09-14T10:00:20.000Z'),
        },
        now,
      ),
    ).toBe(false);
  });

  it('seeds round 1 on a chain slot and is a no-op for every other category', () => {
    expect(
      buildChainRoundSeedData({
        category: GameCategory.CHAIN_GAME,
        gameRuleId: 'rule-1',
        roundPrizes: ['3000', '2000'],
        roundGameRuleIds: ['rule-1', 'rule-2'],
        fixedPrizeAmount: new Prisma.Decimal('5000'),
      }),
    ).toEqual({
      roundIndex: 1,
      gameRuleId: 'rule-1',
      roundPrizeAmount: new Prisma.Decimal('3000'),
    });

    expect(
      buildChainRoundSeedData({
        category: GameCategory.NORMAL,
        gameRuleId: 'rule-1',
        roundPrizes: ['3000', '2000'],
      }),
    ).toEqual({});
  });

  it('splits the round prize, not the whole-chain pool', () => {
    const shares = splitPrizeAmount(new Prisma.Decimal('3000'), 2);
    expect(shares.map((share) => share.toString())).toEqual(['1500', '1500']);
    const poolShares = splitPrizeAmount(new Prisma.Decimal('5000'), 2);
    expect(poolShares.map((share) => share.toString())).not.toEqual(
      shares.map((share) => share.toString()),
    );
  });
});
