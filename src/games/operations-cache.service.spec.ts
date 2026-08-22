import { OperationsCacheService } from './operations-cache.service';

describe('OperationsCacheService', () => {
  let service: OperationsCacheService;

  beforeEach(() => {
    service = new OperationsCacheService();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns cached payload within TTL', () => {
    const generation = service.getGeneration();
    service.write('player', { liveGame: { sessionId: 's1' } }, generation);

    expect(service.read('player')).toEqual({ liveGame: { sessionId: 's1' } });
  });

  it('expires cache entries after TTL', () => {
    const generation = service.getGeneration();
    service.write('player', { value: 1 }, generation);

    jest.advanceTimersByTime(OperationsCacheService.TTL_MS);

    expect(service.read('player')).toBeNull();
  });

  it('keeps player and admin caches separate', () => {
    const generation = service.getGeneration();
    service.write('player', { role: 'player' }, generation);
    service.write('admin', { role: 'admin' }, generation);

    expect(service.read('player')).toEqual({ role: 'player' });
    expect(service.read('admin')).toEqual({ role: 'admin' });
  });

  it('invalidate clears all cached entries and bumps generation', () => {
    const generation = service.getGeneration();
    service.write('player', { value: 1 }, generation);
    service.write('admin', { value: 2 }, generation);

    service.invalidate();

    expect(service.read('player')).toBeNull();
    expect(service.read('admin')).toBeNull();
    expect(service.getGeneration()).toBe(generation + 1);
  });

  it('rejects stale writes when generation changed during loader', () => {
    const generation = service.getGeneration();
    service.invalidate();

    const wrote = service.write('player', { stale: true }, generation);

    expect(wrote).toBe(false);
    expect(service.read('player')).toBeNull();
  });

  it('coalesces 50 concurrent player requests into one loader execution', async () => {
    let loaderCalls = 0;
    const loader = jest.fn(async () => {
      loaderCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { operationsVersion: loaderCalls };
    });

    const requests = Array.from({ length: 50 }, () =>
      service.coalesce('player', loader),
    );
    jest.advanceTimersByTime(10);
    const results = await Promise.all(requests);

    expect(loaderCalls).toBe(1);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.value.operationsVersion === 1)).toBe(
      true,
    );
    expect(results.filter((result) => result.coalesced).length).toBe(49);
  });

  it('allows player A and player B to share the same cached payload', async () => {
    const generation = service.getGeneration();
    const sharedPayload = { operationsVersion: 7, queue: [] };

    service.write('player', sharedPayload, generation);

    expect(service.read('player')).toEqual(sharedPayload);
    expect(service.read('player')).toEqual(sharedPayload);
  });

  it('does not repopulate cache when invalidate happens during in-flight loader', async () => {
    let resolveLoader: ((value: { phase: string }) => void) | undefined;
    const loaderPromise = new Promise<{ phase: string }>((resolve) => {
      resolveLoader = resolve;
    });

    const loaderGeneration = service.getGeneration();
    const inFlight = service.coalesce('player', () => loaderPromise);

    service.invalidate();
    resolveLoader?.({ phase: 'READY' });
    const { value, loaderGeneration: capturedGeneration } = await inFlight;

    expect(value).toEqual({ phase: 'READY' });
    expect(capturedGeneration).toBe(loaderGeneration);

    const wrote = service.write('player', value, capturedGeneration);
    expect(wrote).toBe(false);
    expect(service.read('player')).toBeNull();
  });

  it('cleans up inFlight map after successful loader completion', async () => {
    await service.coalesce('player', async () => ({ ok: true }));

    let loaderCalls = 0;
    await service.coalesce('player', async () => {
      loaderCalls += 1;
      return { ok: true };
    });

    expect(loaderCalls).toBe(1);
  });

  it('cleans up inFlight map after loader error', async () => {
    await expect(
      service.coalesce('player', async () => {
        throw new Error('loader failed');
      }),
    ).rejects.toThrow('loader failed');

    let loaderCalls = 0;
    await service.coalesce('player', async () => {
      loaderCalls += 1;
      return { recovered: true };
    });

    expect(loaderCalls).toBe(1);
  });

  describe('lifecycle stale-write regression', () => {
    it('READY -> PLAYING: invalidate during loader prevents stale cache write', async () => {
      let resolveLoader: ((value: { liveGame: string | null }) => void) | undefined;
      const loaderPromise = new Promise<{ liveGame: string | null }>(
        (resolve) => {
          resolveLoader = resolve;
        },
      );

      const inFlight = service.coalesce('player', () => loaderPromise);
      const loaderGeneration = service.getGeneration();

      service.invalidate();
      resolveLoader?.({ liveGame: 'READY-stale' });
      const { value, loaderGeneration: capturedGeneration } = await inFlight;

      expect(service.write('player', value, capturedGeneration)).toBe(false);
      expect(service.read('player')).toBeNull();

      const freshGeneration = service.getGeneration();
      service.write(
        'player',
        { liveGame: 'PLAYING-fresh' },
        freshGeneration,
      );
      expect(service.read('player')).toEqual({ liveGame: 'PLAYING-fresh' });
      expect(loaderGeneration).toBeLessThan(freshGeneration);
    });

    it('PLAYING -> CHECKING: post-invalidate fresh fetch can be cached', async () => {
      service.invalidate();
      const generation = service.getGeneration();

      service.write('player', { checkingGame: null }, generation);
      service.invalidate();

      const freshGeneration = service.getGeneration();
      service.write(
        'player',
        { checkingGame: 'claim-review' },
        freshGeneration,
      );

      expect(service.read('player')).toEqual({
        checkingGame: 'claim-review',
      });
    });

    it('PLAYING/CHECKING -> WINNER_WINDOW: coalesced waiters share one loader', async () => {
      let loaderCalls = 0;
      const results = await Promise.all([
        service.coalesce('player', async () => {
          loaderCalls += 1;
          return { liveGame: { playerStatus: 'winnerWindow' } };
        }),
        service.coalesce('player', async () => {
          loaderCalls += 1;
          return { liveGame: { playerStatus: 'winnerWindow' } };
        }),
      ]);

      expect(loaderCalls).toBe(1);
      expect(results[0].value).toEqual(results[1].value);
    });

    it('WINNER_WINDOW -> FINISHED: invalidate clears winner-window cache', () => {
      const generation = service.getGeneration();
      service.write(
        'player',
        { liveGame: { playerStatus: 'winnerWindow' } },
        generation,
      );

      service.invalidate();

      expect(service.read('player')).toBeNull();
    });

    it('FINISHED -> next registration: fresh generation required to cache new READY', () => {
      const beforeFinish = service.getGeneration();
      service.write(
        'player',
        { liveGame: { playerStatus: 'finished' } },
        beforeFinish,
      );

      service.invalidate();
      const afterFinish = service.getGeneration();

      expect(
        service.write(
          'player',
          { registrationOpenGame: { sessionId: 'ready-1' } },
          beforeFinish,
        ),
      ).toBe(false);
      expect(
        service.write(
          'player',
          { registrationOpenGame: { sessionId: 'ready-1' } },
          afterFinish,
        ),
      ).toBe(true);
      expect(service.read('player')).toEqual({
        registrationOpenGame: { sessionId: 'ready-1' },
      });
    });
  });
});
