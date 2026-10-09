import { UserRole, UserStatus } from '@prisma/client';
import { RealtimeGateway } from './realtime.gateway';

function setup() {
  const user = {
    id: 'user-1',
    role: UserRole.PLAYER,
    phoneNumber: 'test',
    status: UserStatus.ACTIVE,
  };
  const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: user.id }) };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    gameCartela: { findFirst: jest.fn().mockResolvedValue({ id: 'card-1' }) },
  };
  const observability = {
    bindSocketServer: jest.fn(),
    recordSocketConnected: jest.fn(),
  };
  const realtime = {
    setServer: jest.fn(),
    getPublicGamesRoom: () => 'public:games',
    getUserRoom: (id: string) => `user:${id}`,
    getSessionRoom: (id: string) => `session:${id}`,
  };
  const gateway = new RealtimeGateway(
    jwt as any,
    { getOrThrow: () => '*' } as any,
    prisma as any,
    observability as any,
    { getRequestIdForLog: () => 'test' } as any,
    realtime as any,
  );
  const server = { use: jest.fn() };
  gateway.afterInit(server as any);
  const client = {
    id: 'socket-1',
    data: {},
    handshake: { auth: { token: 'local' }, headers: {} },
    nsp: { name: '/realtime' },
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    disconnect: jest.fn(),
  };
  return { gateway, server, client, jwt, prisma, observability, user };
}

const sessionId = '11111111-1111-4111-8111-111111111111';

describe('authenticated namespace readiness', () => {
  it('waits for user verification before connect; immediate game:join succeeds', async () => {
    const f = setup();
    let release!: (value: unknown) => void;
    f.prisma.user.findUnique.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    expect(f.server.use).toHaveBeenCalledTimes(1);
    const next = jest.fn();
    const middleware = f.server.use.mock.calls[0][0] as any;
    middleware(f.client, next);
    await Promise.resolve();
    await Promise.resolve();
    expect(next).not.toHaveBeenCalled();
    expect((f.client.data as any).user).toBeUndefined();
    release(f.user);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(next).toHaveBeenCalledWith();
    expect((f.client.data as any).user.userId).toBe(f.user.id);
    await f.gateway.handleConnection(f.client as any);
    expect(
      await f.gateway.handleGameJoin(f.client as any, { sessionId }),
    ).toEqual({ joined: true, room: `session:${sessionId}` });
  });

  it('ignores an older session join after a newer session request', async () => {
    const f = setup();
    (f.client.data as any).user = { userId: f.user.id, role: f.user.role };
    let release!: (value: unknown) => void;
    f.prisma.gameCartela.findFirst.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const old = f.gateway.handleGameJoin(f.client as any, { sessionId });
    const newer = '22222222-2222-4222-8222-222222222222';
    expect(
      await f.gateway.handleGameJoin(f.client as any, { sessionId: newer }),
    ).toEqual({ joined: true, room: `session:${newer}` });
    release({ id: 'old-card' });
    expect(await old).toEqual({ joined: false });
    expect(f.client.join).not.toHaveBeenCalledWith(`session:${sessionId}`);
    expect((f.client.data as any).joinedSessionId).toBe(newer);
  });

  it('leave invalidates a pending join even when its ACK has not arrived', async () => {
    const f = setup();
    (f.client.data as any).user = { userId: f.user.id, role: f.user.role };
    let release!: (value: unknown) => void;
    f.prisma.gameCartela.findFirst.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const old = f.gateway.handleGameJoin(f.client as any, { sessionId });
    await f.gateway.handleGameLeave(f.client as any, { sessionId });
    release({ id: 'old-card' });
    expect(await old).toEqual({ joined: false });
    expect(f.client.join).not.toHaveBeenCalledWith(`session:${sessionId}`);
  });

  it('cleans a stale session if adapter join completes after a newer request', async () => {
    const f = setup();
    (f.client.data as any).user = { userId: f.user.id, role: f.user.role };
    let release!: () => void;
    f.client.join.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const old = f.gateway.handleGameJoin(f.client as any, { sessionId });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const newer = '22222222-2222-4222-8222-222222222222';
    await f.gateway.handleGameJoin(f.client as any, { sessionId: newer });
    release();
    expect(await old).toEqual({ joined: false });
    expect(f.client.leave).toHaveBeenCalledWith(`session:${sessionId}`);
    expect((f.client.data as any).joinedSessionId).toBe(newer);
  });

  it('rejects disallowed origins before authentication and connect', async () => {
    const f = setup();
    (f.gateway as any).configService.getOrThrow = () =>
      'https://allowed.invalid';
    (f.client.handshake.headers as any).origin = 'https://rejected.invalid';
    const next = jest.fn();
    (f.server.use.mock.calls[0][0] as any)(f.client, next);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(f.jwt.verifyAsync).not.toHaveBeenCalled();
    expect(f.client.join).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens before connect', async () => {
    const f = setup();
    f.jwt.verifyAsync.mockRejectedValue(new Error('bad token'));
    const next = jest.fn();
    (f.server.use.mock.calls[0][0] as any)(f.client, next);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(f.client.join).not.toHaveBeenCalled();
    expect(f.observability.recordSocketConnected).not.toHaveBeenCalled();
  });

  it('rejects inactive users before connect', async () => {
    const f = setup();
    f.prisma.user.findUnique.mockResolvedValue({
      ...f.user,
      status: UserStatus.BLOCKED,
    });
    const next = jest.fn();
    (f.server.use.mock.calls[0][0] as any)(f.client, next);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(f.client.join).not.toHaveBeenCalled();
  });

  it('preserves guest public-room access without database authentication', async () => {
    const f = setup();
    (f.client.handshake.auth as any) = {};
    const next = jest.fn();
    (f.server.use.mock.calls[0][0] as any)(f.client, next);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(next).toHaveBeenCalledWith();
    expect(f.client.join).toHaveBeenCalledWith('public:games');
    expect(f.jwt.verifyAsync).not.toHaveBeenCalled();
    await expect(
      f.gateway.handleGameJoin(f.client as any, { sessionId }),
    ).rejects.toThrow('Unauthorized');
  });
});
