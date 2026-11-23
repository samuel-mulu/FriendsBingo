import { GamesService } from './games.service';

/**
 * Registration writes must read the session only after taking its row lock, so
 * concurrent registrations cannot race the per-player limit and cannot commit
 * after `startGame` moved the session out of READY.
 */
describe('GamesService registration session lock', () => {
  function buildService() {
    return new GamesService(
      ...(Array.from({ length: 29 }, () => ({})) as ConstructorParameters<
        typeof GamesService
      >),
    );
  }

  function buildTx(lockRows: Array<{ id: string }>) {
    const calls: string[] = [];
    const tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        calls.push(strings.join('?').includes('FOR UPDATE') ? 'lock' : 'query');
        return lockRows;
      }),
      gameSession: {
        findUnique: jest.fn(async () => {
          calls.push('read');
          return { id: 'session-1', status: 'READY' };
        }),
      },
    };
    return { tx, calls };
  }

  type LockedRead = (tx: unknown, sessionId: string) => Promise<unknown>;

  it('locks the GameSession row before reading it', async () => {
    const service = buildService();
    const { tx, calls } = buildTx([{ id: 'session-1' }]);
    const read = (
      service as unknown as { getSessionForRegistrationWrite: LockedRead }
    ).getSessionForRegistrationWrite;

    const session = await read.call(service, tx, 'session-1');

    expect(session).toEqual({ id: 'session-1', status: 'READY' });
    expect(calls).toEqual(['lock', 'read']);
  });

  it('returns null without reading when the session row does not exist', async () => {
    const service = buildService();
    const { tx, calls } = buildTx([]);
    const read = (
      service as unknown as { getSessionForRegistrationWrite: LockedRead }
    ).getSessionForRegistrationWrite;

    await expect(read.call(service, tx, 'missing')).resolves.toBeNull();
    expect(calls).toEqual(['lock']);
    expect(tx.gameSession.findUnique).not.toHaveBeenCalled();
  });
});
