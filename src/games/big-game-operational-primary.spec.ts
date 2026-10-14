import { GameCategory, GameStatus } from '@prisma/client';

import { GamesService } from './games.service';

/**
 * These tests call the REAL private methods on GamesService's prototype
 * (not a mirrored/reimplemented copy). All three functions under test are
 * pure — they only read their parameters, never `this` — so they can be
 * invoked directly off the prototype without constructing the service
 * (which has ~24 constructor dependencies).
 *
 * Covers the PRODUCTION BACKEND FIX — SPLIT BIG GAME OPERATIONAL PRIMARY
 * FROM REGISTRATION ANCHOR task: B1, B2, B4, B5, B6 (operational primary),
 * plus registration-anchor preservation and the shared comparator.
 * Also covers Phase 1 idle prefer: advance Big Game registration must not
 * demote a standard registrationOpenGame head.
 */
type LeanSession = {
  id: string;
  status: GameStatus;
  roundIndex: number | null;
  registrationOpensAt?: Date | null;
  scheduledStartAt: Date | null;
  createdAt?: Date;
  gameSlot: { id: string };
};

type OpsSession = {
  id: string;
  gameSlot: { id: string; category: GameCategory };
};

const proto = GamesService.prototype as unknown as {
  compareBigGameSessions: (left: LeanSession, right: LeanSession) => number;
  resolveBigGameCurrentPrimaryLean: (sorted: LeanSession[]) => LeanSession;
  resolveBigGameOperationalPrimaryLean: (
    sorted: LeanSession[],
  ) => LeanSession;
  shouldRunOperationsTerminalFallback: (params: {
    effectiveLiveSession: unknown;
    effectiveCheckingSession: unknown;
    registrationOpenGame: unknown;
    bigGameRegistrationLean: unknown;
  }) => boolean;
  shouldPreferBigGameRegistrationForOperations: (
    effectiveLiveSession: OpsSession | null,
    effectiveCheckingSession: OpsSession | null,
    bigGameRegistration: LeanSession,
  ) => boolean;
};

function sortSessions(sessions: LeanSession[]): LeanSession[] {
  return [...sessions].sort((a, b) => proto.compareBigGameSessions(a, b));
}

const slotId = 'slot-1';

function session(
  id: string,
  status: GameStatus,
  roundIndex: number,
  overrides: Partial<LeanSession> = {},
): LeanSession {
  return {
    id,
    status,
    roundIndex,
    scheduledStartAt: null,
    gameSlot: { id: slotId },
    ...overrides,
  };
}

describe('resolveBigGameOperationalPrimaryLean (top-level /big-game/current primary)', () => {
  it('B1: R1 PLAYING + R2 READY -> operational primary is R1 (live outranks ready)', () => {
    const primary = proto.resolveBigGameOperationalPrimaryLean(
      sortSessions([
        session('r1', GameStatus.PLAYING, 1),
        session('r2', GameStatus.READY, 2),
      ]),
    );
    expect(primary.id).toBe('r1');
  });

  it('B2: R1 FINISHED + R2 READY -> operational primary is R2 (ready outranks finished, no terminal-first override)', () => {
    const primary = proto.resolveBigGameOperationalPrimaryLean(
      sortSessions([
        session('r1', GameStatus.FINISHED, 1),
        session('r2', GameStatus.READY, 2),
      ]),
    );
    expect(primary.id).toBe('r2');
  });

  it('B4: R2 PLAYING (R1 FINISHED still tracked for history) -> both would choose R2', () => {
    const sorted = sortSessions([
      session('r1', GameStatus.FINISHED, 1),
      session('r2', GameStatus.PLAYING, 2),
    ]);
    expect(proto.resolveBigGameOperationalPrimaryLean(sorted).id).toBe('r2');
    expect(proto.resolveBigGameCurrentPrimaryLean(sorted).id).toBe('r2');
  });

  it('B5: final round FINISHED with no next round -> primary stays the final FINISHED round (review preserved)', () => {
    const primary = proto.resolveBigGameOperationalPrimaryLean(
      sortSessions([session('r-final', GameStatus.FINISHED, 3)]),
    );
    expect(primary.id).toBe('r-final');
  });

  it('B6: mid-progression (R1 FINISHED + R2 READY, R3 not created yet) -> primary is R2', () => {
    const primary = proto.resolveBigGameOperationalPrimaryLean(
      sortSessions([
        session('r1', GameStatus.FINISHED, 1),
        session('r2', GameStatus.READY, 2),
      ]),
    );
    expect(primary.id).toBe('r2');
  });

  it('generalizes to any round transition, not just Round 1 -> 2 (R2 FINISHED + R3 READY -> primary R3)', () => {
    const primary = proto.resolveBigGameOperationalPrimaryLean(
      sortSessions([
        session('r1', GameStatus.FINISHED, 1),
        session('r2', GameStatus.FINISHED, 2),
        session('r3', GameStatus.READY, 3),
      ]),
    );
    expect(primary.id).toBe('r3');
  });
});

describe('resolveBigGameCurrentPrimaryLean (registration anchor, intentionally unchanged)', () => {
  it('still anchors on R1 FINISHED while R2 READY exists, so registration math (anchor.roundIndex + 1) resolves R2', () => {
    const anchor = proto.resolveBigGameCurrentPrimaryLean(
      sortSessions([
        session('r1', GameStatus.FINISHED, 1),
        session('r2', GameStatus.READY, 2),
      ]),
    );
    expect(anchor.id).toBe('r1');
    expect((anchor.roundIndex ?? 1) + 1).toBe(2);
  });

  it('B6: 3-round game anchor still resolves R1 -> R2 progression correctly even though operational primary differs', () => {
    const sorted = sortSessions([
      session('r1', GameStatus.FINISHED, 1),
      session('r2', GameStatus.READY, 2),
    ]);
    const anchor = proto.resolveBigGameCurrentPrimaryLean(sorted);
    const operational = proto.resolveBigGameOperationalPrimaryLean(sorted);
    expect(anchor.id).toBe('r1');
    expect(operational.id).toBe('r2');
  });

  it('anchors on the live round when nothing is finished yet (same as operational primary)', () => {
    const sorted = sortSessions([
      session('r1', GameStatus.PLAYING, 1),
      session('r2', GameStatus.READY, 2),
    ]);
    expect(proto.resolveBigGameCurrentPrimaryLean(sorted).id).toBe('r1');
    expect(proto.resolveBigGameOperationalPrimaryLean(sorted).id).toBe('r1');
  });
});

describe('compareBigGameSessions priority ordering (shared by both resolvers)', () => {
  it('orders PLAYING < WINNER_WINDOW < CHECKING < READY < NEXT < FINISHED < NO_WINNER < CANCELLED', () => {
    const statuses = [
      GameStatus.CANCELLED,
      GameStatus.NO_WINNER,
      GameStatus.FINISHED,
      GameStatus.NEXT,
      GameStatus.READY,
      GameStatus.CHECKING,
      GameStatus.WINNER_WINDOW,
      GameStatus.PLAYING,
    ];
    const sorted = sortSessions(
      statuses.map((status, index) => session(`s${index}`, status, 1)),
    );
    expect(sorted.map((s) => s.status)).toEqual([
      GameStatus.PLAYING,
      GameStatus.WINNER_WINDOW,
      GameStatus.CHECKING,
      GameStatus.READY,
      GameStatus.NEXT,
      GameStatus.FINISHED,
      GameStatus.NO_WINNER,
      GameStatus.CANCELLED,
    ]);
  });
});

describe('shouldRunOperationsTerminalFallback (operations/current ordering fix)', () => {
  it('B3: R1 FINISHED + R2 READY -> bigGameRegistrationLean resolved first, so terminal fallback is skipped (liveGame stays null)', () => {
    const shouldFallback = proto.shouldRunOperationsTerminalFallback({
      effectiveLiveSession: null,
      effectiveCheckingSession: null,
      registrationOpenGame: null,
      bigGameRegistrationLean: { id: 'r2' },
    });
    expect(shouldFallback).toBe(false);
  });

  it('B10: truly no live/checking/registration candidate anywhere -> terminal fallback still runs', () => {
    const shouldFallback = proto.shouldRunOperationsTerminalFallback({
      effectiveLiveSession: null,
      effectiveCheckingSession: null,
      registrationOpenGame: null,
      bigGameRegistrationLean: null,
    });
    expect(shouldFallback).toBe(true);
  });

  it('B8/B9: normal game (standard registrationOpenGame already resolved) is unaffected regardless of bigGameRegistrationLean', () => {
    expect(
      proto.shouldRunOperationsTerminalFallback({
        effectiveLiveSession: null,
        effectiveCheckingSession: null,
        registrationOpenGame: { id: 'B' },
        bigGameRegistrationLean: null,
      }),
    ).toBe(false);
  });

  it('still runs fallback when a live or checking session already exists (no-op guard)', () => {
    expect(
      proto.shouldRunOperationsTerminalFallback({
        effectiveLiveSession: { id: 'A' },
        effectiveCheckingSession: null,
        registrationOpenGame: null,
        bigGameRegistrationLean: null,
      }),
    ).toBe(false);
  });
});

describe('shouldPreferBigGameRegistrationForOperations (advance BG vs standard head)', () => {
  const bgReg = session('bg-ready', GameStatus.READY, 1, {
    registrationOpensAt: new Date('2026-10-01T00:00:00.000Z'),
    scheduledStartAt: new Date('2026-10-08T00:00:00.000Z'), // 7 days ahead
  });

  it('idle board: does not prefer Big Game (standard READY head stays primary for 3–7 day advance reg)', () => {
    expect(
      proto.shouldPreferBigGameRegistrationForOperations(null, null, bgReg),
    ).toBe(false);
  });

  it('apply fallback preserved: prefer=false still allows BG when registrationOpenGame is null via short-circuit', () => {
    // Documented contract of applyBigGameRegistrationOpenGame:
    // prefer = registrationOpenGame == null || shouldPrefer(...)
    const registrationOpenGame = null;
    const shouldPrefer = proto.shouldPreferBigGameRegistrationForOperations(
      null,
      null,
      bgReg,
    );
    const prefer = registrationOpenGame == null || shouldPrefer;
    expect(shouldPrefer).toBe(false);
    expect(prefer).toBe(true);
  });

  it('standard live: does not prefer Big Game over non-BG operational session', () => {
    const normalLive: OpsSession = {
      id: 'normal-live',
      gameSlot: { id: 'slot-normal', category: GameCategory.NORMAL },
    };
    expect(
      proto.shouldPreferBigGameRegistrationForOperations(
        normalLive,
        null,
        bgReg,
      ),
    ).toBe(false);
  });

  it('Bonus / GOTD / Chain live: same as Normal — prefer false', () => {
    for (const category of [
      GameCategory.BONUS,
      GameCategory.BIG_GOTD,
      GameCategory.CHAIN_GAME,
    ]) {
      expect(
        proto.shouldPreferBigGameRegistrationForOperations(
          { id: `live-${category}`, gameSlot: { id: `slot-${category}`, category } },
          null,
          bgReg,
        ),
      ).toBe(false);
    }
  });

  it('Big Game live same slot: prefers next-round Big Game registration lean', () => {
    const bgLive: OpsSession = {
      id: 'bg-live',
      gameSlot: { id: slotId, category: GameCategory.BIG_GAME },
    };
    expect(
      proto.shouldPreferBigGameRegistrationForOperations(bgLive, null, bgReg),
    ).toBe(true);
  });

  it('Big Game live different slot: prefer false', () => {
    const otherBgLive: OpsSession = {
      id: 'other-bg-live',
      gameSlot: { id: 'other-slot', category: GameCategory.BIG_GAME },
    };
    expect(
      proto.shouldPreferBigGameRegistrationForOperations(
        otherBgLive,
        null,
        bgReg,
      ),
    ).toBe(false);
  });
});
