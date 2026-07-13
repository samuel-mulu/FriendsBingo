import {
  resolveBonusLikeInsertPlan,
  selectRegistrationCandidatesPreferringFilled,
} from './game-queue-bonus-insert';

describe('resolveBonusLikeInsertPlan', () => {
  it('inserts after live when there is no READY', () => {
    expect(
      resolveBonusLikeInsertPlan({
        liveMaxSortOrder: 1,
        ready: null,
      }),
    ).toEqual({
      insertSortOrder: 2,
      demoteEmptyReady: null,
    });
  });

  it('inserts at 1 when idle (no live, no READY)', () => {
    expect(
      resolveBonusLikeInsertPlan({
        liveMaxSortOrder: null,
        ready: null,
      }),
    ).toEqual({
      insertSortOrder: 1,
      demoteEmptyReady: null,
    });
  });

  it('inserts after live and demotes empty READY', () => {
    expect(
      resolveBonusLikeInsertPlan({
        liveMaxSortOrder: 1,
        ready: {
          slotId: 'slot-ready',
          sessionId: 'session-ready',
          sortOrder: 2,
          cartelaCount: 0,
        },
      }),
    ).toEqual({
      insertSortOrder: 2,
      demoteEmptyReady: {
        slotId: 'slot-ready',
        sessionId: 'session-ready',
      },
    });
  });

  it('inserts immediately after READY that has registered cartelas', () => {
    expect(
      resolveBonusLikeInsertPlan({
        liveMaxSortOrder: 1,
        ready: {
          slotId: 'slot-ready',
          sessionId: 'session-ready',
          sortOrder: 2,
          cartelaCount: 5,
        },
      }),
    ).toEqual({
      insertSortOrder: 3,
      demoteEmptyReady: null,
    });
  });

  it('inserts after filled READY with no live', () => {
    expect(
      resolveBonusLikeInsertPlan({
        liveMaxSortOrder: null,
        ready: {
          slotId: 'slot-ready',
          sessionId: 'session-ready',
          sortOrder: 1,
          cartelaCount: 3,
        },
      }),
    ).toEqual({
      insertSortOrder: 2,
      demoteEmptyReady: null,
    });
  });
});

describe('selectRegistrationCandidatesPreferringFilled', () => {
  it('returns all candidates when none have cartelas', () => {
    const candidates = [
      {
        slotId: 'bonus',
        registeredCartelasCount: 0,
        sortOrder: 2,
        category: 'BONUS',
      },
      {
        slotId: 'normal',
        registeredCartelasCount: 0,
        sortOrder: 1,
        category: 'NORMAL',
      },
    ];

    expect(selectRegistrationCandidatesPreferringFilled(candidates)).toEqual(
      candidates,
    );
  });

  it('prefers filled READY by lowest sortOrder over empty bonus', () => {
    const candidates = [
      {
        slotId: 'bonus',
        registeredCartelasCount: 0,
        sortOrder: 3,
        category: 'BONUS',
      },
      {
        slotId: 'normal-filled',
        registeredCartelasCount: 5,
        sortOrder: 2,
        category: 'NORMAL',
      },
      {
        slotId: 'other-filled',
        registeredCartelasCount: 1,
        sortOrder: 4,
        category: 'NORMAL',
      },
    ];

    expect(
      selectRegistrationCandidatesPreferringFilled(candidates).map(
        (item) => item.slotId,
      ),
    ).toEqual(['normal-filled', 'other-filled']);
  });
});
