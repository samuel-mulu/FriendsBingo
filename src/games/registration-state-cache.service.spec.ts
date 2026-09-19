import { GameCategory, GameStatus } from '@prisma/client';
import { RegistrationStateCacheService } from './registration-state-cache.service';

describe('RegistrationStateCacheService', () => {
  let service: RegistrationStateCacheService;

  beforeEach(() => {
    service = new RegistrationStateCacheService();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('coalesces 50 concurrent same-session requests into one loader execution', async () => {
    let loaderCalls = 0;
    const loader = jest.fn(async () => {
      loaderCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { sessionId: 's1', gameCartelas: [] };
    });

    const requests = Array.from({ length: 50 }, () =>
      service.coalesce('s1', loader),
    );
    jest.advanceTimersByTime(10);
    const results = await Promise.all(requests);

    expect(loaderCalls).toBe(1);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.coalesced).length).toBe(49);
  });

  it('returns cached payload within TTL without reloading', async () => {
    let loaderCalls = 0;
    const loader = async () => {
      loaderCalls += 1;
      return { value: 1 };
    };

    await service.load('s1', loader);
    await service.load('s1', loader);

    expect(loaderCalls).toBe(1);
  });

  it('expires cache entries after TTL and reloads', async () => {
    let loaderCalls = 0;
    const loader = async () => {
      loaderCalls += 1;
      return { value: loaderCalls };
    };

    await service.load('s1', loader);
    jest.advanceTimersByTime(RegistrationStateCacheService.TTL_MS);
    await service.load('s1', loader);

    expect(loaderCalls).toBe(2);
  });

  it('requires fresh load after explicit invalidate', async () => {
    let loaderCalls = 0;
    const loader = async () => {
      loaderCalls += 1;
      return { value: loaderCalls };
    };

    await service.load('s1', loader);
    service.invalidate('s1');
    await service.load('s1', loader);

    expect(loaderCalls).toBe(2);
  });

  it('does not repopulate cache when invalidate happens during in-flight loader', async () => {
    let resolveLoader: ((value: { phase: string }) => void) | undefined;
    const loaderPromise = new Promise<{ phase: string }>((resolve) => {
      resolveLoader = resolve;
    });

    const loaderGeneration = service.getGeneration('s1');
    const inFlight = service.coalesce('s1', () => loaderPromise);

    service.invalidate('s1');
    resolveLoader?.({ phase: 'READY' });
    const { value, loaderGeneration: capturedGeneration } = await inFlight;

    expect(value).toEqual({ phase: 'READY' });
    expect(capturedGeneration).toBe(loaderGeneration);

    const wrote = service.write('s1', value, capturedGeneration);
    expect(wrote).toBe(false);
    expect(service.read('s1')).toBeNull();
  });

  it('invalidates affected session on explicit invalidate call', () => {
    const generation = service.getGeneration('expiry-session');
    service.write('expiry-session', { reservations: [] }, generation);

    service.invalidate('expiry-session');

    expect(service.read('expiry-session')).toBeNull();
    expect(service.getGeneration('expiry-session')).toBe(generation + 1);
  });

  it('cleans up inFlight map after loader error and allows recovery', async () => {
    await expect(
      service.coalesce('s1', async () => {
        throw new Error('loader failed');
      }),
    ).rejects.toThrow('loader failed');

    let loaderCalls = 0;
    await service.coalesce('s1', async () => {
      loaderCalls += 1;
      return { recovered: true };
    });

    expect(loaderCalls).toBe(1);
  });

  it('keeps different sessionIds isolated', async () => {
    const loaderA = jest.fn(async () => ({ sessionId: 'a' }));
    const loaderB = jest.fn(async () => ({ sessionId: 'b' }));

    await service.load('session-a', loaderA);
    await service.load('session-b', loaderB);

    expect(service.read<{ sessionId: string }>('session-a')).toEqual({
      sessionId: 'a',
    });
    expect(service.read<{ sessionId: string }>('session-b')).toEqual({
      sessionId: 'b',
    });
    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).toHaveBeenCalledTimes(1);
  });

  it('invalidates ready sessions in the same cartela pool', async () => {
    const prisma = {
      gameSession: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ready-1' },
          { id: 'ready-2' },
        ]),
      },
    };

    const generationA = service.getGeneration('ready-1');
    const generationB = service.getGeneration('ready-2');
    service.write('ready-1', { cached: true }, generationA);
    service.write('ready-2', { cached: true }, generationB);

    await service.invalidateReadySessionsInPool(
      prisma as never,
      GameCategory.NORMAL,
    );

    expect(prisma.gameSession.findMany).toHaveBeenCalledWith({
      where: {
        status: GameStatus.READY,
        gameSlot: {
          category: {
            in: [
              GameCategory.NORMAL,
              GameCategory.BONUS,
              GameCategory.BIG_GOTD,
              GameCategory.CHAIN_GAME,
            ],
          },
        },
      },
      select: { id: true },
    });
    expect(service.read('ready-1')).toBeNull();
    expect(service.read('ready-2')).toBeNull();
  });
});
