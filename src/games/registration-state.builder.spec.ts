import { GameCategory, GameStatus } from '@prisma/client';
import {
  buildRegistrationStateForUser,
  SharedRegistrationSnapshot,
} from './registration-state.builder';

function buildSnapshot(
  overrides: Partial<SharedRegistrationSnapshot> = {},
): SharedRegistrationSnapshot {
  return {
    sessionId: 'session-1',
    session: {
      status: GameStatus.READY,
      entryFee: { toString: () => '10' },
      gameSlot: {
        category: GameCategory.NORMAL,
        fixedPrizeAmount: null,
        maxCartelasPerPlayer: 4,
      },
    },
    gameCartelas: [
      {
        id: 'gc-1',
        cartelaId: 'c-1',
        userId: 'user-a',
        status: 'REGISTERED',
        isWinner: false,
        paymentSource: null,
        cartela: { id: 'c-1', number: 1 },
      },
      {
        id: 'gc-2',
        cartelaId: 'c-2',
        userId: 'user-b',
        status: 'REGISTERED',
        isWinner: false,
        paymentSource: null,
        cartela: { id: 'c-2', number: 2 },
      },
    ],
    gameCartelaReservations: [
      {
        cartelaId: 'c-3',
        userId: 'user-a',
        expiresAt: new Date('2026-09-19T12:00:00.000Z'),
        cartela: { id: 'c-3', number: 3 },
      },
      {
        cartelaId: 'c-4',
        userId: 'user-b',
        expiresAt: new Date('2026-09-19T12:00:00.000Z'),
        cartela: { id: 'c-4', number: 4 },
      },
    ],
    liveLockedCartelas: [
      {
        id: 'gc-live',
        cartelaId: 'c-live',
        userId: 'user-live',
        status: 'REGISTERED',
        isWinner: false,
        paymentSource: null,
        cartela: { id: 'c-live', number: 99 },
      },
    ],
    liveLockedReservations: [],
    ...overrides,
  };
}

describe('buildRegistrationStateForUser', () => {
  it('isolates user A and user B overlay fields', () => {
    const snapshot = buildSnapshot();

    const userA = buildRegistrationStateForUser(snapshot, 'user-a', 'slim');
    const userB = buildRegistrationStateForUser(snapshot, 'user-b', 'slim');

    expect(userA.myCartelaIds).toEqual(['c-1']);
    expect(userB.myCartelaIds).toEqual(['c-2']);

    const ownerForC1A = userA.registeredCartelasSummary.find(
      (item) => item.cartelaId === 'c-1',
    )?.owner;
    const ownerForC1B = userB.registeredCartelasSummary.find(
      (item) => item.cartelaId === 'c-1',
    )?.owner;

    expect(ownerForC1A).toBe('ME');
    expect(ownerForC1B).toBe('OTHER');
  });

  it('preserves reservation owner semantics', () => {
    const snapshot = buildSnapshot();
    const userA = buildRegistrationStateForUser(snapshot, 'user-a', 'full');
    const userB = buildRegistrationStateForUser(snapshot, 'user-b', 'full');

    const reservedByA = userA.registeredCartelasSummary.find(
      (item) => item.cartelaId === 'c-3',
    );
    const reservedByB = userB.registeredCartelasSummary.find(
      (item) => item.cartelaId === 'c-3',
    );

    expect(reservedByA).toMatchObject({
      owner: 'RESERVED_ME',
      status: 'RESERVED',
      expiresAt: '2026-09-19T12:00:00.000Z',
    });
    expect(reservedByB).toMatchObject({
      owner: 'RESERVED_OTHER',
      status: 'RESERVED',
    });
  });

  it('merges READY live-lock rows without inflating this-session counts', () => {
    const snapshot = buildSnapshot();
    const result = buildRegistrationStateForUser(snapshot, 'user-a', 'slim');

    expect(result.registeredCartelasCount).toBe(2);
    expect(result.reservedCartelasCount).toBe(2);
    expect(
      result.registeredCartelasSummary.some(
        (item) => item.cartelaId === 'c-live',
      ),
    ).toBe(true);
    expect(
      result.registeredCartelasSummary.find((item) => item.cartelaId === 'c-live')
        ?.owner,
    ).toBe('OTHER');
  });

  it('preserves full and slim response shapes', () => {
    const snapshot = buildSnapshot({
      session: {
        status: GameStatus.READY,
        entryFee: { toString: () => '10' },
        gameSlot: {
          category: GameCategory.BONUS,
          fixedPrizeAmount: { toString: () => '100' },
          maxCartelasPerPlayer: 2,
        },
      },
    });

    const slim = buildRegistrationStateForUser(snapshot, 'user-a', 'slim');
    const full = buildRegistrationStateForUser(snapshot, 'user-a', 'full');

    expect(slim).toMatchObject({
      sessionId: 'session-1',
      category: GameCategory.BONUS,
      entryFee: '10',
      fixedPrizeAmount: '100',
      maxCartelasPerPlayer: 2,
      registeredCartelasCount: 2,
      reservedCartelasCount: 2,
      remainingFreeCartelas: 1,
    });
    expect(slim).not.toHaveProperty('reservedCartelasSummary');

    expect(full).toHaveProperty('reservedCartelasSummary');
    expect(full.reservedCartelasSummary?.length).toBeGreaterThan(0);
  });

  it('maps WINNER status from isWinner flag', () => {
    const snapshot = buildSnapshot({
      gameCartelas: [
        {
          id: 'gc-win',
          cartelaId: 'c-win',
          userId: 'user-a',
          status: 'REGISTERED',
          isWinner: true,
          paymentSource: null,
          cartela: { id: 'c-win', number: 7 },
        },
      ],
      gameCartelaReservations: [],
      liveLockedCartelas: [],
    });

    const result = buildRegistrationStateForUser(snapshot, 'user-a', 'slim');
    expect(
      result.registeredCartelasSummary.find((item) => item.cartelaId === 'c-win')
        ?.status,
    ).toBe('WINNER');
  });
});
