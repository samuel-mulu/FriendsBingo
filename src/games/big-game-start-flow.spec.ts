import { GameCategory, GameStatus } from '@prisma/client';
import {
  getRuntimeQueuePriority,
  isDueBigGameReady,
} from './game-category.util';

describe('Big Game start due / priority (butter-flow)', () => {
  const now = new Date('2026-09-08T12:00:00.000Z');

  it('treats READY Big Game with past play-start as due', () => {
    expect(
      isDueBigGameReady(
        GameCategory.BIG_GAME,
        GameStatus.READY,
        new Date('2026-09-08T11:00:00.000Z'),
        now,
      ),
    ).toBe(true);
  });

  it('treats READY Big Game with null play-start as due (stranded heal)', () => {
    expect(
      isDueBigGameReady(
        GameCategory.BIG_GAME,
        GameStatus.READY,
        null,
        now,
      ),
    ).toBe(true);
  });

  it('does not treat future play-start as due', () => {
    expect(
      isDueBigGameReady(
        GameCategory.BIG_GAME,
        GameStatus.READY,
        new Date('2026-09-08T13:00:00.000Z'),
        now,
      ),
    ).toBe(false);
  });

  it('prioritizes due Big Game over standard queue', () => {
    const bigPriority = getRuntimeQueuePriority(
      GameCategory.BIG_GAME,
      GameStatus.READY,
      new Date('2026-09-08T11:00:00.000Z'),
      now,
    );
    const normalPriority = getRuntimeQueuePriority(
      GameCategory.NORMAL,
      GameStatus.READY,
      new Date('2026-09-08T11:00:00.000Z'),
      now,
    );
    expect(bigPriority).toBeLessThan(normalPriority);
  });

  it('prioritizes stranded (null start) Big Game over standard queue', () => {
    const bigPriority = getRuntimeQueuePriority(
      GameCategory.BIG_GAME,
      GameStatus.READY,
      null,
      now,
    );
    const normalPriority = getRuntimeQueuePriority(
      GameCategory.NORMAL,
      GameStatus.READY,
      null,
      now,
    );
    expect(bigPriority).toBeLessThan(normalPriority);
  });
});

describe('Big Game start-now held error contract', () => {
  it('documents BIG_GAME_HELD_BY_LIVE payload shape', () => {
    const payload = {
      code: 'BIG_GAME_HELD_BY_LIVE',
      message: 'Close or cancel live game MANUAL-S2 before starting the Big Game',
      blockingLiveGame: {
        sessionId: 'sess-1',
        staticCode: 'MANUAL-S2',
        playCode: 'BINGO-1',
        playerStatus: 'playing',
      },
    };
    expect(payload.code).toBe('BIG_GAME_HELD_BY_LIVE');
    expect(payload.blockingLiveGame.staticCode).toBe('MANUAL-S2');
  });
});
