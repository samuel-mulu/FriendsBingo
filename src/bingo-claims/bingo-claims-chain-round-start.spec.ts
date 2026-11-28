import { GameCategory } from '@prisma/client';
import { BingoClaimsService } from './bingo-claims.service';

/**
 * Chain games keep every ball across rounds: the previous round's winning ball is still
 * the "latest ball" when the next round opens. A round must accept claims only after it
 * has resumed and drawn at least one ball after that winning ball.
 */
describe('BingoClaimsService chain round-start claim gate', () => {
  const sessionId = 'session-1';

  type Blocker = (
    tx: unknown,
    session: unknown,
    latestCalledOrder: number | null,
  ) => Promise<string | null>;

  const service = Object.create(BingoClaimsService.prototype) as {
    getChainRoundStartBlocker: Blocker;
  };

  function session(overrides: {
    category?: GameCategory;
    roundIndex?: number;
    roundPausedUntil?: Date | null;
  }) {
    return {
      id: sessionId,
      roundIndex: overrides.roundIndex ?? 2,
      roundPausedUntil: overrides.roundPausedUntil ?? null,
      gameSlot: {
        id: 'slot-1',
        gameType: 'ONE_LINE',
        category: overrides.category ?? GameCategory.CHAIN_GAME,
        gameRule: null,
      },
    };
  }

  function buildTx(
    previousWinningBall: number | null,
    winningBallOrder: number,
  ) {
    return {
      gameSessionRoundResult: {
        findUnique: jest.fn(() =>
          Promise.resolve(
            previousWinningBall == null
              ? null
              : { winningBallNumber: previousWinningBall },
          ),
        ),
      },
      calledNumber: {
        findFirst: jest.fn(() => Promise.resolve({ order: winningBallOrder })),
      },
    };
  }

  it('ignores non-chain games', async () => {
    const tx = buildTx(31, 22);
    await expect(
      service.getChainRoundStartBlocker(
        tx,
        session({ category: GameCategory.NORMAL }),
        22,
      ),
    ).resolves.toBeNull();
    expect(tx.gameSessionRoundResult.findUnique).not.toHaveBeenCalled();
  });

  it('allows round 1 claims', async () => {
    await expect(
      service.getChainRoundStartBlocker(
        buildTx(null, 0),
        session({ roundIndex: 1 }),
        5,
      ),
    ).resolves.toBeNull();
  });

  it('rejects claims during the inter-round pause', async () => {
    await expect(
      service.getChainRoundStartBlocker(
        buildTx(31, 22),
        session({ roundPausedUntil: new Date(Date.now() + 10_000) }),
        23,
      ),
    ).resolves.toBe('The next round has not started yet');
  });

  it('rejects a new-round claim when no ball was drawn after the previous winning ball', async () => {
    await expect(
      service.getChainRoundStartBlocker(buildTx(31, 22), session({}), 22),
    ).resolves.toBe('Wait for the first ball of this round');
  });

  it('allows a new-round claim once a new ball was drawn', async () => {
    await expect(
      service.getChainRoundStartBlocker(buildTx(31, 22), session({}), 23),
    ).resolves.toBeNull();
  });

  it('does not block when the previous round has no winning ball', async () => {
    await expect(
      service.getChainRoundStartBlocker(buildTx(null, 0), session({}), 22),
    ).resolves.toBeNull();
  });
});
