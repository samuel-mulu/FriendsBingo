import { RealtimeService } from './realtime.service';
import { SESSION_CARTELAS_BATCH_MS } from './session-cartelas-updated-batcher';

describe('RealtimeService', () => {
  function createService() {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const server = { to } as never;
    const service = new RealtimeService();

    service.setServer(server);

    return { service, emit, to };
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('emits to the expected rooms', () => {
    const { service, emit, to } = createService();

    service.emitToGame('game-1', 'game:number_called', { number: 15 });
    service.emitToUser('user-1', 'wallet:updated', { balance: '10.00' });
    service.emitToAdmin('deposit:updated', { id: 'dep-1' });
    service.emitToPublicGames('game:created', { id: 'game-1' });

    expect(to).toHaveBeenNthCalledWith(1, 'session:game-1');
    expect(to).toHaveBeenNthCalledWith(2, 'user:user-1');
    expect(to).toHaveBeenNthCalledWith(3, 'admin');
    expect(to).toHaveBeenNthCalledWith(4, 'games:public');
    expect(emit).toHaveBeenCalledTimes(4);
  });

  it('emits a single cartela update after the batch window', () => {
    const { service, emit } = createService();

    service.emitSessionCartelasUpdated({
      sessionId: 'session-1',
      slotId: 'slot-1',
      registeredCartelasCount: 3,
      changes: [
        {
          cartelaId: 'cartela-45',
          cartelaNumber: 45,
          owner: 'RESERVED_OTHER',
          actorUserId: 'user-2',
        },
      ],
    });

    expect(emit).not.toHaveBeenCalled();

    jest.advanceTimersByTime(SESSION_CARTELAS_BATCH_MS);

    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenCalledWith(
      'session:cartelas_updated',
      expect.objectContaining({
        sessionId: 'session-1',
        changes: [
          expect.objectContaining({
            cartelaNumber: 45,
            owner: 'RESERVED_OTHER',
          }),
        ],
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      'session:cartelas_updated',
      expect.objectContaining({
        sessionId: 'session-1',
        slotId: 'slot-1',
        registeredCartelasCount: 3,
        changes: [
          expect.objectContaining({
            cartelaNumber: 45,
          }),
        ],
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      'session:cartelas_updated',
      expect.objectContaining({
        sessionId: 'session-1',
        slotId: 'slot-1',
        registeredCartelasCount: 3,
      }),
    );
    expect(emit.mock.calls[2][1]).not.toHaveProperty('changes');
  });

  it('coalesces many updates within 50ms into one emit with merged changes', () => {
    const { service, emit } = createService();

    for (let number = 1; number <= 20; number++) {
      service.emitSessionCartelasUpdated({
        sessionId: 'session-1',
        slotId: 'slot-1',
        registeredCartelasCount: number,
        changes: [
          {
            cartelaId: `cartela-${number}`,
            cartelaNumber: number,
            owner: 'RESERVED_OTHER',
            actorUserId: 'user-2',
          },
        ],
      });
    }

    jest.advanceTimersByTime(SESSION_CARTELAS_BATCH_MS);

    const sessionEmits = emit.mock.calls.filter(
      ([event, payload]) =>
        event === 'session:cartelas_updated' &&
        Array.isArray((payload as { changes?: unknown[] }).changes),
    );
    const publicEmit = emit.mock.calls.find(
      ([event, payload]) =>
        event === 'session:cartelas_updated' &&
        !Object.prototype.hasOwnProperty.call(payload, 'changes'),
    );

    expect(sessionEmits).toHaveLength(2);
    expect(sessionEmits[0][1]).toEqual(sessionEmits[1][1]);
    expect(sessionEmits[0][1]).toEqual(
      expect.objectContaining({
        registeredCartelasCount: 20,
        changes: expect.arrayContaining([
          expect.objectContaining({ cartelaNumber: 1 }),
          expect.objectContaining({ cartelaNumber: 20 }),
        ]),
      }),
    );
    expect(
      (sessionEmits[0][1] as { changes: unknown[] }).changes,
    ).toHaveLength(20);
    expect(publicEmit?.[1]).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        slotId: 'slot-1',
        registeredCartelasCount: 20,
      }),
    );
    expect(emit).toHaveBeenCalledTimes(3);
  });

  it('keeps only the latest state when the same cartela updates twice in a batch', () => {
    const { service, emit } = createService();

    service.emitSessionCartelasUpdated({
      sessionId: 'session-1',
      slotId: 'slot-1',
      changes: [
        {
          cartelaId: 'cartela-9',
          cartelaNumber: 9,
          owner: 'RESERVED_OTHER',
          actorUserId: 'user-2',
        },
      ],
    });
    service.emitSessionCartelasUpdated({
      sessionId: 'session-1',
      slotId: 'slot-1',
      changes: [
        {
          cartelaId: 'cartela-9',
          cartelaNumber: 9,
          owner: 'OTHER',
          actorUserId: 'user-2',
        },
      ],
    });

    jest.advanceTimersByTime(SESSION_CARTELAS_BATCH_MS);

    const sessionEmit = emit.mock.calls.find(
      ([event, payload]) =>
        event === 'session:cartelas_updated' &&
        Array.isArray((payload as { changes?: unknown[] }).changes),
    );

    expect(sessionEmit?.[1]).toEqual(
      expect.objectContaining({
        changes: [
          expect.objectContaining({
            cartelaId: 'cartela-9',
            owner: 'OTHER',
          }),
        ],
      }),
    );
  });

  it('flushes pending cartela updates before session status changes', () => {
    const { service, emit } = createService();

    service.emitSessionCartelasUpdated({
      sessionId: 'session-1',
      slotId: 'slot-1',
      changes: [
        {
          cartelaId: 'cartela-1',
          cartelaNumber: 1,
          owner: 'OTHER',
          actorUserId: 'user-2',
        },
      ],
    });

    service.emitToSession('session-1', 'game:status_changed', {
      sessionId: 'session-1',
      status: 'PLAYING',
    });

    const emitOrder = emit.mock.calls.map(([event]) => event);
    expect(emitOrder.slice(0, 3)).toEqual([
      'session:cartelas_updated',
      'session:cartelas_updated',
      'session:cartelas_updated',
    ]);
    expect(emitOrder[3]).toBe('game:status_changed');
  });

  it('keeps wallet updates immediate', () => {
    const { service, emit } = createService();

    service.emitSessionCartelasUpdated({
      sessionId: 'session-1',
      slotId: 'slot-1',
      changes: [
        {
          cartelaId: 'cartela-1',
          cartelaNumber: 1,
          owner: 'RESERVED_OTHER',
          actorUserId: 'user-2',
        },
      ],
    });
    service.emitToUser('user-1', 'wallet:updated', { balance: '25.00' });

    expect(emit).toHaveBeenCalledWith('wallet:updated', { balance: '25.00' });
    expect(emit).not.toHaveBeenCalledWith(
      'session:cartelas_updated',
      expect.anything(),
    );
  });
});
