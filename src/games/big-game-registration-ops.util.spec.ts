import { GameStatus } from '@prisma/client';

import {
  canRegisterBigGameLeanSession,
  pickBigGameRegistrationSessionLean,
} from './big-game-registration-ops.util';

describe('pickBigGameRegistrationSessionLean', () => {
  const slotId = 'slot-1';
  const now = new Date('2026-09-08T10:00:00.000Z');
  const regWindowEnd = new Date('2026-09-08T10:05:00.000Z');

  const canRegister = (session: {
    status: GameStatus;
    registrationOpensAt: Date | null;
    scheduledStartAt: Date | null;
  }) =>
    canRegisterBigGameLeanSession(
      {
        id: 'x',
        roundIndex: 1,
        gameSlot: { id: slotId },
        ...session,
      },
      now,
    );

  it('returns Round 1 READY when that is the only session', () => {
    const r1 = {
      id: 'r1',
      status: GameStatus.READY,
      roundIndex: 1,
      registrationOpensAt: now,
      scheduledStartAt: regWindowEnd,
      gameSlot: { id: slotId },
    };
    const picked = pickBigGameRegistrationSessionLean(
      [r1],
      (sorted) => sorted[0],
      canRegister,
    );
    expect(picked?.id).toBe('r1');
  });

  it('returns Round 2 READY when Round 1 is FINISHED', () => {
    const r1 = {
      id: 'r1',
      status: GameStatus.FINISHED,
      roundIndex: 1,
      registrationOpensAt: now,
      scheduledStartAt: regWindowEnd,
      gameSlot: { id: slotId },
    };
    const r2 = {
      id: 'r2',
      status: GameStatus.READY,
      roundIndex: 2,
      registrationOpensAt: now,
      scheduledStartAt: regWindowEnd,
      gameSlot: { id: slotId },
    };
    const sorted = [r1, r2];
    const picked = pickBigGameRegistrationSessionLean(
      sorted,
      (sessions) => sessions[0],
      canRegister,
    );
    expect(picked?.id).toBe('r2');
  });

  it('returns null while Round 1 is LIVE (Option A)', () => {
    const r1 = {
      id: 'r1',
      status: GameStatus.PLAYING,
      roundIndex: 1,
      registrationOpensAt: now,
      scheduledStartAt: regWindowEnd,
      gameSlot: { id: slotId },
    };
    const picked = pickBigGameRegistrationSessionLean(
      [r1],
      (sorted) => sorted[0],
      canRegister,
    );
    expect(picked).toBeNull();
  });
});
