import {
  buildPublicCartelasSummaryPayload,
  buildSessionCartelasUpdatedPayload,
  createCartelasUpdatedBatch,
  mergeCartelasUpdatedPayload,
} from './session-cartelas-updated-batcher';

describe('session-cartelas-updated-batcher', () => {
  it('merges multiple changes and keeps latest state per cartelaId', () => {
    const batch = createCartelasUpdatedBatch({
      sessionId: 'session-1',
      slotId: 'slot-1',
      registeredCartelasCount: 1,
      changes: [
        {
          cartelaId: 'cartela-1',
          cartelaNumber: 12,
          owner: 'RESERVED_OTHER',
          actorUserId: 'user-2',
        },
      ],
    });

    mergeCartelasUpdatedPayload(batch, {
      sessionId: 'session-1',
      slotId: 'slot-1',
      registeredCartelasCount: 2,
      changes: [
        {
          cartelaId: 'cartela-1',
          cartelaNumber: 12,
          owner: 'OTHER',
          actorUserId: 'user-2',
        },
        {
          cartelaId: 'cartela-2',
          cartelaNumber: 34,
          owner: 'RESERVED_OTHER',
          actorUserId: 'user-3',
        },
      ],
    });

    expect(buildSessionCartelasUpdatedPayload(batch)).toEqual({
      sessionId: 'session-1',
      slotId: 'slot-1',
      registeredCartelasCount: 2,
      changes: [
        {
          cartelaId: 'cartela-1',
          cartelaNumber: 12,
          owner: 'OTHER',
          actorUserId: 'user-2',
        },
        {
          cartelaId: 'cartela-2',
          cartelaNumber: 34,
          owner: 'RESERVED_OTHER',
          actorUserId: 'user-3',
        },
      ],
    });
  });

  it('builds public summary without detailed changes', () => {
    const payload = buildSessionCartelasUpdatedPayload(
      createCartelasUpdatedBatch({
        sessionId: 'session-1',
        slotId: 'slot-1',
        prizeAmount: '960.00',
        registeredCartelasCount: 120,
        changes: [
          {
            cartelaId: 'cartela-1',
            cartelaNumber: 12,
            owner: 'OTHER',
            actorUserId: 'user-2',
          },
        ],
      }),
    );

    expect(buildPublicCartelasSummaryPayload(payload)).toEqual({
      sessionId: 'session-1',
      slotId: 'slot-1',
      prizeAmount: '960.00',
      registeredCartelasCount: 120,
    });
    expect(buildPublicCartelasSummaryPayload(payload)).not.toHaveProperty(
      'changes',
    );
  });
});
