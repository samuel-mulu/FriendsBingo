import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { GameCategory, GameStatus, UserRole, UserStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  createServer as createTcpServer,
  type Socket as TcpSocket,
} from 'node:net';
import { Client } from 'pg';
import { createClient } from 'redis';
import { io, type Socket } from 'socket.io-client';
import { PrismaService } from '../prisma/prisma.service';
import { ObservabilityService } from '../observability/observability.service';
import { RequestContextService } from '../observability/request-context.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { SocketIoRedisService } from './socket-io-redis.service';
import { RedisIoAdapter } from './redis-io.adapter';

const sessionId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const jwt = new JwtService({
  secret: 'isolated-socket-fixture-signing-key-only',
});
const user = {
  id: userId,
  role: UserRole.PLAYER,
  status: UserStatus.ACTIVE,
  phoneNumber: 'fixture',
};
const sockets: Socket[] = [];
const apps: INestApplication[] = [];

async function backend(redisUrl?: string, prefix?: string, database?: Client) {
  const config = new ConfigService({
    NODE_ENV: 'test',
    CORS_ORIGINS: '*',
    SOCKET_IO_REDIS_ENABLED: !!redisUrl,
    REDIS_URL: redisUrl,
    SOCKET_IO_REDIS_CHANNEL_PREFIX: prefix,
  });
  // This harness tests real transports and the unchanged gateway, not claim
  // validation. In the opt-in suite the auth/room fixtures use isolated PG.
  const prisma = {
    user: {
      findUnique: async ({ where }: any) =>
        database
          ? (
              await database.query(
                'SELECT * FROM socket_test_user WHERE id=$1',
                [where.id],
              )
            ).rows[0]
          : where.id === userId
            ? user
            : null,
    },
    gameCartela: {
      findFirst: async ({ where }: any) =>
        database
          ? (
              await database.query(
                'SELECT id FROM socket_test_cartela WHERE session_id=$1 AND user_id=$2',
                [where.gameSessionId, where.userId],
              )
            ).rows[0]
          : where.userId === userId && where.gameSessionId === sessionId
            ? { id: 'fixture-card' }
            : null,
    },
    gameSession: {
      findUnique: async () => ({ id: sessionId, status: GameStatus.PLAYING }),
    },
  };
  const module = await Test.createTestingModule({
    providers: [
      RealtimeGateway,
      RealtimeService,
      SocketIoRedisService,
      { provide: ConfigService, useValue: config },
      { provide: JwtService, useValue: jwt },
      { provide: PrismaService, useValue: prisma },
      {
        provide: ObservabilityService,
        useValue: {
          bindSocketServer() {},
          recordSocketConnected() {},
          recordSocketDisconnected() {},
        },
      },
      {
        provide: RequestContextService,
        useValue: { getRequestIdForLog: () => 'socket-fixture' },
      },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  apps.push(app);
  const redis = app.get(SocketIoRedisService);
  if (redis.enabled) {
    await redis.initialize();
    app.useWebSocketAdapter(new RedisIoAdapter(app, redis));
  }
  await app.init();
  await redis.verifyReady();
  await app.listen(0, '127.0.0.1');
  return {
    app,
    redis,
    realtime: app.get(RealtimeService),
    url: `${await app.getUrl()}/realtime`,
  };
}

async function connect(
  url: string,
  transport: 'websocket' | 'polling' = 'websocket',
  token = jwt.sign({ sub: userId }),
) {
  const socket = io(url, {
    path: '/socket.io',
    transports: [transport],
    auth: { token },
    forceNew: true,
    reconnection: false,
    autoConnect: false,
    timeout: 2000,
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
    socket.connect();
  });
  return socket;
}

async function join(socket: Socket) {
  expect(
    await socket.timeout(2000).emitWithAck('game:join', { sessionId }),
  ).toEqual({ joined: true, room: `session:${sessionId}` });
}

async function delivery(
  socket: Socket,
  event: string,
  payload: unknown,
  emit: () => void,
) {
  const received: unknown[] = [];
  const listener = (value: unknown) => received.push(value);
  socket.on(event, listener);
  try {
    const first = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(event, done);
        reject(new Error('Expected realtime delivery timed out'));
      }, 3000);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.once(event, done);
    });
    emit();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(received).toEqual([payload]);
  } finally {
    socket.off(event, listener);
  }
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('unchanged single-instance Socket.IO with Redis disabled / real transports', () => {
  it.each(['websocket', 'polling'] as const)(
    'authenticates before game:join ACK over %s',
    async (transport) => {
      const server = await backend();
      expect(server.redis.enabled).toBe(false);
      const socket = await connect(server.url, transport);
      await join(socket);
      const payload = { sessionId, status: 'VALID' };
      await delivery(socket, 'game:bingo_valid', payload, () =>
        server.realtime.emitToSession(sessionId, 'game:bingo_valid', payload),
      );
    },
  );

  it('rejects invalid authentication with the existing Unauthorized protocol', async () => {
    const server = await backend();
    await expect(
      connect(server.url, 'websocket', 'invalid-test-token'),
    ).rejects.toThrow('Unauthorized');
  });

  it.each(Object.values(GameCategory))(
    'preserves %s terminal and round payloads without duplicate delivery',
    async (category) => {
      const server = await backend();
      const socket = await connect(server.url);
      await join(socket);
      const events = [
        'game:bingo_valid',
        'game:bingo_invalid',
        'game:bingo_claim_failed',
        'game:winner_window_started',
        'game:number_called',
        'chain:round_started',
        'game:status_changed',
      ];
      for (const event of events) {
        const payload = { sessionId, category, roundIndex: 2, event };
        await delivery(socket, event, payload, () =>
          server.realtime.emitToSession(sessionId, event, payload),
        );
      }
    },
  );
});

describe('enabled adapter bounded startup / real node-redis clients', () => {
  it('fails closed when a loopback endpoint never answers Redis commands', async () => {
    const connections = new Set<TcpSocket>();
    const blackhole = createTcpServer((socket) => {
      connections.add(socket);
      socket.on('close', () => connections.delete(socket));
    });
    await new Promise<void>((resolve) =>
      blackhole.listen(0, '127.0.0.1', resolve),
    );
    const address = blackhole.address() as { port: number };
    const config = new ConfigService({
      SOCKET_IO_REDIS_ENABLED: true,
      REDIS_URL: `redis://127.0.0.1:${address.port}`,
      SOCKET_IO_REDIS_CHANNEL_PREFIX: 'friends-bingo:startup-test',
    });
    const redis = new SocketIoRedisService(config);
    const started = Date.now();
    try {
      await expect(redis.initialize()).rejects.toThrow(
        'server will not listen',
      );
      expect(redis.isReady()).toBe(false);
      expect(Date.now() - started).toBeLessThan(15_000);
    } finally {
      await redis.onApplicationShutdown();
      for (const socket of connections) socket.destroy();
      await new Promise<void>((resolve) => blackhole.close(() => resolve()));
    }
  }, 20_000);
});

// No .env fallback. Refuse the Windows legacy Redis and any remote database.
const redisUrl = process.env.BINGO_REDIS_TEST_URL;
const databaseUrl = process.env.BINGO_FENCING_TEST_DATABASE_URL;
const isolatedDescribe = redisUrl && databaseUrl ? describe : describe.skip;
isolatedDescribe(
  'two-instance Redis transport / isolated PostgreSQL auth fixtures',
  () => {
    let databases: Client[] = [];
    let control: ReturnType<typeof createClient>;
    let prefix: string;

    beforeAll(async () => {
      const redis = new URL(redisUrl!);
      const postgres = new URL(databaseUrl!);
      if (
        redis.protocol !== 'redis:' ||
        redis.hostname !== '127.0.0.1' ||
        redis.port !== '16379' ||
        postgres.protocol !== 'postgresql:' ||
        postgres.hostname !== '127.0.0.1' ||
        postgres.port !== '65439' ||
        postgres.pathname !== '/stage2a_claim_fencing'
      ) {
        throw new Error('Refusing non-isolated Redis/PostgreSQL endpoints');
      }
      prefix = `friends-bingo:transport-test:${randomUUID()}`;
      databases = [
        new Client({ connectionString: databaseUrl }),
        new Client({ connectionString: databaseUrl }),
      ];
      for (const db of databases) {
        await db.connect();
        await db.query(
          'CREATE TEMP TABLE socket_test_user(id text, role text, status text, "phoneNumber" text)',
        );
        await db.query(
          'CREATE TEMP TABLE socket_test_cartela(id text, session_id text, user_id text)',
        );
        await db.query('INSERT INTO socket_test_user VALUES($1,$2,$3,$4)', [
          userId,
          user.role,
          user.status,
          user.phoneNumber,
        ]);
        await db.query('INSERT INTO socket_test_cartela VALUES($1,$2,$3)', [
          'fixture-card',
          sessionId,
          userId,
        ]);
      }
      control = createClient({ url: redisUrl });
      control.on('error', () => {});
      await control.connect();
    }, 15_000);

    afterAll(async () => {
      if (control?.isOpen) await control.close();
      await Promise.all(databases.map((db) => db.end()));
    });

    it('delivers session, user, admin, slot, public and all-client events across two temporary ports', async () => {
      const a = await backend(redisUrl, prefix, databases[0]);
      const b = await backend(redisUrl, prefix, databases[1]);
      const first = await connect(a.url);
      const second = await connect(b.url);
      await join(first);
      await join(second);
      const payload = { sessionId, status: 'FAILED', retryAllowed: true };
      await delivery(second, 'game:bingo_claim_failed', payload, () =>
        a.realtime.emitToSession(sessionId, 'game:bingo_claim_failed', payload),
      );
      await delivery(second, 'game:bingo_invalid', payload, () =>
        a.realtime.emitToUser(userId, 'game:bingo_invalid', payload),
      );
      const guest = io(b.url, {
        forceNew: true,
        transports: ['websocket'],
        autoConnect: false,
      });
      sockets.push(guest);
      await new Promise<void>((resolve, reject) => {
        guest.once('connect', resolve);
        guest.once('connect_error', reject);
        guest.connect();
      });
      await delivery(guest, 'game:status_changed', payload, () =>
        a.realtime.emitToPublicGames('game:status_changed', payload),
      );
      await delivery(second, 'game:finished', payload, () =>
        a.realtime.emitToAllRealtimeClients('game:finished', payload),
      );
      // Local-only fixture joins exercise the existing admin and slot room names.
      for (const room of ['admin', 'slot:test-slot']) {
        b.app.get(RealtimeGateway).server.in(second.id!).socketsJoin(room);
        await delivery(second, 'game:operation_updated', payload, () =>
          room === 'admin'
            ? a.realtime.emitToAdmin('game:operation_updated', payload)
            : a.realtime.emitToSlot(
                'test-slot',
                'game:operation_updated',
                payload,
              ),
        );
      }
    }, 20_000);

    it.each(Object.values(GameCategory))(
      'delivers %s terminal, auto-call and transition notifications exactly once',
      async (category) => {
        const a = await backend(redisUrl, prefix, databases[0]);
        const b = await backend(redisUrl, prefix, databases[1]);
        const first = await connect(a.url);
        const second = await connect(b.url, 'polling');
        await join(first);
        await join(second);
        for (const event of [
          'game:bingo_valid',
          'game:bingo_invalid',
          'game:winner_window_started',
          'game:winner_window_joined',
          'game:number_called',
          'chain:round_finished',
          'chain:round_started',
          'game:finished',
          'game:status_changed',
        ]) {
          const payload = { sessionId, category, roundIndex: 2, event };
          await delivery(second, event, payload, () =>
            a.realtime.emitToSession(sessionId, event, payload),
          );
        }
      },
      20_000,
    );

    it.each(['pub', 'sub'])(
      'restores %s connections and subscriptions after connection loss and allows rejoin',
      async (connection) => {
        const a = await backend(redisUrl, prefix, databases[0]);
        const b = await backend(redisUrl, prefix, databases[1]);
        const first = await connect(a.url);
        const second = await connect(b.url);
        await join(first);
        await join(second);
        const disconnect = Promise.all(
          [first, second].map(
            (socket) =>
              new Promise<void>((resolve) =>
                socket.once('disconnect', () => resolve()),
              ),
          ),
        );
        // Kill only this suite's uniquely named connections, never another app's.
        const list = String(await control.sendCommand(['CLIENT', 'LIST']));
        const ids = list
          .split('\n')
          .filter((line) => line.includes(`name=${prefix}:${connection}:`))
          .map((line) => /(?:^| )id=(\d+)/.exec(line)?.[1]);
        expect(ids).toHaveLength(2);
        for (const id of ids)
          await control.sendCommand(['CLIENT', 'KILL', 'ID', id!]);
        await disconnect;
        expect(a.redis.isReady()).toBe(false);
        expect(b.redis.isReady()).toBe(false);
        const deadline = Date.now() + 12_000;
        while (
          (!a.redis.isReady() || !b.redis.isReady()) &&
          Date.now() < deadline
        )
          await new Promise((resolve) => setTimeout(resolve, 100));
        expect(a.redis.isReady()).toBe(true);
        expect(b.redis.isReady()).toBe(true);
        const restored = await connect(b.url);
        await join(restored);
        const payload = { sessionId, status: 'VALID' };
        await delivery(restored, 'game:bingo_valid', payload, () =>
          a.realtime.emitToSession(sessionId, 'game:bingo_valid', payload),
        );
      },
      20_000,
    );
  },
);
