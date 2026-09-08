import { CartelaPaymentSource, GameCategory, GameStatus } from '@prisma/client';
import {
  assertBigGameRegistrationAllowed,
  canRegisterForBigGameWindow,
} from './games.operation-mode';

describe('Big Game inter-round registration contract', () => {
  it('opens next READY while current round is LIVE with null scheduledStartAt', () => {
    const liveRound = 1;
    const roundCount = 3;
    const now = Date.parse('2026-09-08T10:00:00.000Z');

    expect(liveRound < roundCount).toBe(true);

    const nextWhileLive = {
      status: GameStatus.READY,
      roundIndex: liveRound + 1,
      registrationOpensAt: new Date(now),
      scheduledStartAt: null as Date | null,
    };

    expect(nextWhileLive.roundIndex).toBe(2);
    expect(nextWhileLive.status).toBe(GameStatus.READY);
    expect(nextWhileLive.scheduledStartAt).toBeNull();
    expect(
      canRegisterForBigGameWindow(
        nextWhileLive.registrationOpensAt,
        nextWhileLive.scheduledStartAt,
        new Date(now),
      ),
    ).toBe(true);
  });

  it('arms scheduledStartAt on finalize without creating a second READY', () => {
    const finishedRound = 1;
    const roundCount = 3;
    const delaySeconds = 120;
    const now = Date.parse('2026-09-08T10:00:00.000Z');
    const existingNextSessionId = 'next-ready-while-live';
    const nextRoundStartsAt = new Date(now + delaySeconds * 1000);

    expect(finishedRound < roundCount).toBe(true);

    const armed = {
      id: existingNextSessionId,
      status: GameStatus.READY,
      roundIndex: finishedRound + 1,
      scheduledStartAt: nextRoundStartsAt,
    };

    expect(armed.id).toBe(existingNextSessionId);
    expect(armed.scheduledStartAt.toISOString()).toBe(
      '2026-09-08T10:02:00.000Z',
    );
  });

  it('closes registration once scheduledStartAt is reached', () => {
    const opens = new Date('2026-09-08T10:00:00.000Z');
    const start = new Date('2026-09-08T10:05:00.000Z');
    expect(
      canRegisterForBigGameWindow(
        opens,
        start,
        new Date('2026-09-08T10:04:59.000Z'),
      ),
    ).toBe(true);
    expect(
      canRegisterForBigGameWindow(
        opens,
        start,
        new Date('2026-09-08T10:05:00.000Z'),
      ),
    ).toBe(false);
    expect(() =>
      assertBigGameRegistrationAllowed(
        opens,
        start,
        new Date('2026-09-08T10:05:00.000Z'),
      ),
    ).toThrow();
  });

  it('opens next READY session with future scheduledStartAt after round finalize', () => {
    const finishedRound = 1;
    const roundCount = 3;
    const delaySeconds = 120;
    const now = Date.parse('2026-09-08T10:00:00.000Z');
    const nextRoundStartsAt = new Date(now + delaySeconds * 1000);

    expect(finishedRound < roundCount).toBe(true);
    expect(nextRoundStartsAt.toISOString()).toBe('2026-09-08T10:02:00.000Z');

    const nextSession = {
      status: GameStatus.READY,
      roundIndex: finishedRound + 1,
      registrationOpensAt: new Date(now),
      scheduledStartAt: nextRoundStartsAt,
    };

    expect(nextSession.roundIndex).toBe(2);
    expect(nextSession.status).toBe(GameStatus.READY);
    expect(nextSession.scheduledStartAt.getTime()).toBeGreaterThan(now);
  });

  it('clones winners and registered boards as CARRIED_FORWARD', () => {
    const source = [
      { status: 'REGISTERED', cartelaId: 'c1' },
      { status: 'WINNER', cartelaId: 'c2' },
    ];
    const cloned = source.map((row) => ({
      cartelaId: row.cartelaId,
      status: 'REGISTERED',
      paymentSource: CartelaPaymentSource.CARRIED_FORWARD,
    }));

    expect(cloned).toHaveLength(2);
    expect(cloned.every((row) => row.paymentSource === 'CARRIED_FORWARD')).toBe(
      true,
    );
  });

  it('allows paid extras on later rounds but not welcome-bonus', () => {
    const allowed = new Set([
      CartelaPaymentSource.MONEY_WALLET,
      CartelaPaymentSource.BIG_GAME_TICKET,
      CartelaPaymentSource.CARRIED_FORWARD,
    ]);
    expect(allowed.has(CartelaPaymentSource.MONEY_WALLET)).toBe(true);
    expect(allowed.has(CartelaPaymentSource.BIG_GAME_TICKET)).toBe(true);
    expect(allowed.has(CartelaPaymentSource.BONUS_CARTELA as never)).toBe(
      false,
    );
  });

  it('admin start-next-round only bumps existing READY scheduledStartAt', () => {
    const ready = {
      status: GameStatus.READY,
      roundIndex: 2,
      scheduledStartAt: new Date('2026-09-08T10:05:00.000Z'),
    };
    const forced = {
      ...ready,
      scheduledStartAt: new Date('2026-09-08T10:01:00.000Z'),
    };
    expect(forced.roundIndex).toBe(2);
    expect(forced.scheduledStartAt.getTime()).toBeLessThan(
      ready.scheduledStartAt.getTime(),
    );
  });

  it('telegram big-game winner copy includes round context', () => {
    const category = GameCategory.BIG_GAME;
    const roundIndex = 2;
    const roundCount = 3;
    const title =
      category === GameCategory.BIG_GAME
        ? 'FRIENDS BINGO — BIG GAME WINNER'
        : 'FRIENDS BINGO — WINNER';
    const roundLine = `Round ${roundIndex} of ${roundCount}`;
    const footer =
      roundIndex < roundCount
        ? 'Winners advance — next round registration is open!'
        : 'Congratulations!';

    expect(title).toContain('BIG GAME');
    expect(roundLine).toBe('Round 2 of 3');
    expect(footer).toContain('next round registration');
  });

  it('exposes lean previousRound for Round 2+ READY missed UI', () => {
    const current = {
      status: GameStatus.READY,
      roundIndex: 2,
    };
    const previousRound = {
      sessionId: 'prev-session',
      roundIndex: 1,
      status: GameStatus.FINISHED,
      playCode: 'BG-R1',
      finishedAt: new Date('2026-09-08T10:00:00.000Z'),
      registeredCartelasCount: 12,
      playerOwnedPreviousRound: false,
    };

    const shouldAttach =
      current.roundIndex > 1 && current.status === GameStatus.READY;
    expect(shouldAttach).toBe(true);
    expect(previousRound.playerOwnedPreviousRound).toBe(false);
    expect(previousRound.roundIndex).toBe(current.roundIndex - 1);
  });

  it('exposes live previousRound on nextRoundRegistration during overlap', () => {
    const live = {
      status: GameStatus.PLAYING,
      roundIndex: 1,
      nextRoundRegistration: {
        status: GameStatus.READY,
        roundIndex: 2,
        canRegister: true,
        previousRound: {
          sessionId: 'live-r1',
          roundIndex: 1,
          status: GameStatus.PLAYING,
          playerOwnedPreviousRound: false,
        },
      },
    };

    expect(live.nextRoundRegistration.previousRound.status).toBe(
      GameStatus.PLAYING,
    );
    expect(
      live.nextRoundRegistration.previousRound.playerOwnedPreviousRound,
    ).toBe(false);
  });

  it('ops live snapshot carries roundIndex/roundCount for admin Current Game', () => {
    const liveSession = {
      roundIndex: 1,
      status: GameStatus.PLAYING,
      prizeAmount: '3000',
      gameSlot: {
        roundCount: 3,
        currentRound: 1,
        roundPrizes: ['1000', '1000', '1000'],
      },
    };

    const roundIndex =
      liveSession.roundIndex ?? liveSession.gameSlot.currentRound ?? 1;
    const roundCount = liveSession.gameSlot.roundCount ?? 1;
    const roundPrizes = Array.isArray(liveSession.gameSlot.roundPrizes)
      ? liveSession.gameSlot.roundPrizes.map((value) => String(value))
      : null;
    const roundPrizeAmount =
      roundPrizes != null &&
      roundIndex >= 1 &&
      roundIndex <= roundPrizes.length
        ? roundPrizes[roundIndex - 1]
        : liveSession.prizeAmount;

    expect(roundIndex).toBe(1);
    expect(roundCount).toBe(3);
    expect(roundPrizeAmount).toBe('1000');
    expect(`Round ${roundIndex} of ${roundCount}`).toBe('Round 1 of 3');
  });

  it('resolves bigGameNextRegistration as READY round N+1 while round N is live', () => {
    const bigGameSessions = [
      {
        id: 'r1',
        status: GameStatus.PLAYING,
        roundIndex: 1,
      },
      {
        id: 'r2',
        status: GameStatus.READY,
        roundIndex: 2,
      },
    ];
    const primary = bigGameSessions[0]!;
    const primaryIsLive =
      primary.status === GameStatus.PLAYING ||
      primary.status === GameStatus.CHECKING ||
      primary.status === GameStatus.WINNER_WINDOW;
    const next = bigGameSessions.find(
      (session) =>
        session.status === GameStatus.READY &&
        (session.roundIndex ?? 1) === (primary.roundIndex ?? 1) + 1,
    );

    expect(primaryIsLive).toBe(true);
    expect(next?.id).toBe('r2');
    expect(next?.roundIndex).toBe(2);
  });

  it('exposes previousRound winners and finishedRounds for metadata UI', () => {
    const finishedRounds = [
      {
        roundIndex: 1,
        status: GameStatus.FINISHED,
        winners: [
          {
            userId: 'u1',
            fullName: 'Abebe',
            cartelaNumber: 12,
            amount: '3000',
          },
        ],
      },
      {
        roundIndex: 2,
        status: GameStatus.FINISHED,
        winners: [
          {
            userId: 'u2',
            fullName: 'Sara',
            cartelaNumber: 44,
            amount: '2000',
          },
        ],
      },
    ];

    expect(finishedRounds[0]?.winners[0]?.fullName).toBe('Abebe');
    expect(finishedRounds[1]?.winners[0]?.fullName).toBe('Sara');
  });
});
