import { GameCategory, GameStatus } from '@prisma/client';
import { AutoCallService } from './auto-call.service';
import { ChainRoundResumeService } from './chain-round-resume.service';

const now = new Date('2026-10-09T12:00:00.000Z');
const deadline = new Date(now.getTime() - 1000);

function fixture() {
  const row = {
    id: 'chain-session',
    gameSlotId: 'chain-slot',
    status: GameStatus.PLAYING as GameStatus,
    roundIndex: 2,
    roundPausedUntil: new Date(deadline) as Date | null,
    roundPrizeAmount: { toString: () => '2000' },
    gameRuleId: 'round-2-rule',
    gameSlot: { category: GameCategory.CHAIN_GAME, roundCount: 3 },
    autoCallEnabled: false,
    autoCallIntervalMs: 7000,
    nextAutoCallAt: null as Date | null,
    _count: { calledNumbers: 18 },
  };
  const snapshot = () => ({
    ...row,
    roundPausedUntil: row.roundPausedUntil && new Date(row.roundPausedUntil),
  });
  // In-memory atomic conditional-write fixture. It evaluates the production
  // Prisma predicate against the latest row, rather than always returning 1.
  // This verifies stale callbacks, not PostgreSQL lock/concurrency behavior.
  const updateMany = jest.fn(async ({ where, data }) => {
    const pause = where.roundPausedUntil;
    if (
      where.id !== row.id ||
      where.status !== row.status ||
      (where.roundIndex !== undefined && where.roundIndex !== row.roundIndex) ||
      (pause.not === null && row.roundPausedUntil === null) ||
      ('equals' in pause &&
        row.roundPausedUntil?.getTime() !== pause.equals?.getTime()) ||
      ('lte' in pause &&
        (row.roundPausedUntil === null || row.roundPausedUntil > pause.lte))
    )
      return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  });
  const prisma = {
    gameSession: {
      updateMany,
      findMany: jest.fn(async ({ select }) => [
        Object.fromEntries(
          Object.entries(snapshot()).filter(([key]) => key in select),
        ),
      ]),
      findUnique: jest.fn(async () => snapshot()),
      update: jest.fn(async ({ data }) => {
        Object.assign(row, data);
        return snapshot();
      }),
    },
  };
  const autoCall = { startAutoCall: jest.fn().mockResolvedValue(undefined) };
  const rounds = { emitRoundStarted: jest.fn() };
  const cache = { invalidate: jest.fn() };
  const service = new ChainRoundResumeService(
    prisma as any,
    autoCall as any,
    rounds as any,
    cache as any,
  );
  const resume = (attempt = snapshot(), worker = service) =>
    (worker as any).resumeSession(attempt) as Promise<void>;
  const unchangedSideEffects = () => {
    expect(autoCall.startAutoCall).not.toHaveBeenCalled();
    expect(rounds.emitRoundStarted).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  };
  return {
    row,
    snapshot,
    prisma,
    autoCall,
    rounds,
    cache,
    service,
    resume,
    unchangedSideEffects,
  };
}

describe('Chain round resume ownership', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });
  afterEach(() => jest.useRealTimers());

  it('resumes the current due round with the existing event payload', async () => {
    const f = fixture();
    await f.resume();
    expect(f.row.roundPausedUntil).toBeNull();
    expect(f.row.roundIndex).toBe(2);
    expect(f.rounds.emitRoundStarted).toHaveBeenCalledTimes(1);
    expect(f.rounds.emitRoundStarted).toHaveBeenCalledWith({
      sessionId: 'chain-session',
      slotId: 'chain-slot',
      roundIndex: 2,
      roundCount: 3,
      roundPrizeAmount: '2000',
      gameRuleId: 'round-2-rule',
    });
    expect(f.autoCall.startAutoCall).toHaveBeenCalledTimes(1);
    expect(f.autoCall.startAutoCall).toHaveBeenCalledWith('chain-session');
  });

  it('rejects an old round-2 callback after round 3 has replaced its pause', async () => {
    const f = fixture();
    const old = f.snapshot();
    f.row.roundIndex = 3;
    // Keep the same deadline to prove round identity independently of time.
    await f.resume(old);
    expect(f.row.roundPausedUntil).toEqual(deadline);
    f.unchangedSideEffects();
  });

  it.each([-500, 60_000])(
    'rejects a same-round callback whose pause deadline changed by %i ms',
    async (offset) => {
      const f = fixture();
      const old = f.snapshot();
      const replacement = new Date(now.getTime() + offset);
      f.row.roundPausedUntil = replacement;
      await f.resume(old);
      expect(f.row.roundPausedUntil).toEqual(replacement);
      f.unchangedSideEffects();
    },
  );

  it('does not resume a matching pause before its deadline', async () => {
    const f = fixture();
    f.row.roundPausedUntil = new Date(now.getTime() + 60_000);
    await f.resume();
    expect(f.row.roundPausedUntil).not.toBeNull();
    f.unchangedSideEffects();
  });

  it('does not let a callback with a missing pause identity act on a paused row', async () => {
    const f = fixture();
    const old = { ...f.snapshot(), roundPausedUntil: null };
    await f.resume(old);
    expect(f.row.roundPausedUntil).toEqual(deadline);
    f.unchangedSideEffects();
  });

  it('makes a duplicate callback harmless after the first successful resume', async () => {
    const f = fixture();
    const attempt = f.snapshot();
    await f.resume(attempt);
    await f.resume(attempt);
    expect(f.autoCall.startAutoCall).toHaveBeenCalledTimes(1);
    expect(f.rounds.emitRoundStarted).toHaveBeenCalledTimes(1);
    expect(f.cache.invalidate).toHaveBeenCalledTimes(1);
  });

  it('permits only one of two competing workers to act on the same pause', async () => {
    const f = fixture();
    const attempt = f.snapshot();
    const other = new ChainRoundResumeService(
      f.prisma as any,
      f.autoCall as any,
      f.rounds as any,
      f.cache as any,
    );
    await Promise.all([f.resume(attempt), f.resume(attempt, other)]);
    expect(f.row.roundPausedUntil).toBeNull();
    expect(f.autoCall.startAutoCall).toHaveBeenCalledTimes(1);
    expect(f.rounds.emitRoundStarted).toHaveBeenCalledTimes(1);
  });

  it.each([
    GameStatus.READY,
    GameStatus.WINNER_WINDOW,
    GameStatus.FINISHED,
    GameStatus.NO_WINNER,
    GameStatus.CANCELLED,
  ])('ignores a callback once the session becomes %s', async (status) => {
    const f = fixture();
    const old = f.snapshot();
    f.row.status = status;
    await f.resume(old);
    expect(f.row.roundPausedUntil).toEqual(deadline);
    f.unchangedSideEffects();
  });

  it('uses the fetched deadline through the real scheduler scan', async () => {
    const f = fixture();
    await (f.service as any).tick();
    expect(f.row.roundPausedUntil).toBeNull();
    expect(f.autoCall.startAutoCall).toHaveBeenCalledTimes(1);
    expect(f.prisma.gameSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ roundPausedUntil: true }),
      }),
    );
  });

  it('rejects a stale scheduler snapshot after a newer round arrives before the write', async () => {
    const f = fixture();
    const stale = f.snapshot();
    f.prisma.gameSession.findMany.mockImplementationOnce(async () => {
      f.row.roundIndex = 3;
      f.row.roundPausedUntil = new Date(now.getTime() + 60_000);
      return [stale];
    });
    await (f.service as any).tick();
    expect(f.row.roundIndex).toBe(3);
    expect(f.row.roundPausedUntil).not.toBeNull();
    f.unchangedSideEffects();
  });

  it('waits for the successful database write before emitting or starting calling', async () => {
    const f = fixture();
    let commit!: () => void;
    f.prisma.gameSession.updateMany.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          commit = () => {
            f.row.roundPausedUntil = null;
            resolve({ count: 1 });
          };
        }),
    );
    const pending = f.resume();
    f.unchangedSideEffects();
    commit();
    await pending;
    expect(f.rounds.emitRoundStarted).toHaveBeenCalledTimes(1);
    expect(f.autoCall.startAutoCall).toHaveBeenCalledTimes(1);
  });

  it('does not emit or start calling after a failed database write', async () => {
    const f = fixture();
    f.prisma.gameSession.updateMany.mockRejectedValueOnce(
      new Error('database write failed'),
    );
    await expect(f.resume()).rejects.toThrow('database write failed');
    expect(f.row.roundPausedUntil).toEqual(deadline);
    f.unchangedSideEffects();
  });

  it('preserves normal automatic-call scheduling and never draws a ball immediately on resume', async () => {
    const f = fixture();
    const numbers = {
      callRandomNumber: jest.fn(),
      callRandomNumberForAutoCall: jest.fn(),
    };
    const realtime = {
      emitToAdmin: jest.fn(),
      emitToPublicGames: jest.fn(),
      emitToGame: jest.fn(),
    };
    const autoCall = new AutoCallService(
      f.prisma as any,
      { getAutoCallIntervalMs: async () => 7000 } as any,
      numbers as any,
      undefined as any,
      realtime as any,
    );
    const worker = new ChainRoundResumeService(
      f.prisma as any,
      autoCall,
      f.rounds as any,
      f.cache as any,
    );
    await f.resume(f.snapshot(), worker);
    expect(f.row.autoCallEnabled).toBe(true);
    expect(f.row.nextAutoCallAt).toEqual(new Date(now.getTime() + 7000));
    expect(f.row._count.calledNumbers).toBe(18);
    expect(numbers.callRandomNumber).not.toHaveBeenCalled();
    expect(numbers.callRandomNumberForAutoCall).not.toHaveBeenCalled();
  });
});
