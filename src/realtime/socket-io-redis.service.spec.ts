import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'node:events';
import { createClient } from 'redis';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { SocketIoRedisService } from './socket-io-redis.service';
import { RealtimeService } from './realtime.service';
import { HealthService } from '../health/health.service';
import { envValidationSchema } from '../config/env.validation';

jest.mock('redis', () => ({ createClient: jest.fn() }));

function fixture(enabled = true) {
  const handlers = new Map<string, (message: string) => void>();
  function client() {
    const value = new EventEmitter() as any;
    value.isOpen = false;
    value.isReady = false;
    value.connect = jest.fn(async () => {
      value.isOpen = value.isReady = true;
      value.emit('ready');
    });
    value.close = jest.fn(async () => {
      value.isOpen = value.isReady = false;
      value.emit('end');
    });
    value.destroy = jest.fn(() => {
      value.isOpen = value.isReady = false;
    });
    value.subscribe = jest.fn(async (channels, callback) => {
      for (const channel of [channels].flat()) handlers.set(channel, callback);
    });
    value.pSubscribe = jest.fn().mockResolvedValue(undefined);
    value.unsubscribe = jest.fn().mockResolvedValue(undefined);
    value.pUnsubscribe = jest.fn().mockResolvedValue(undefined);
    value.publish = jest.fn(async (channel, message) => {
      handlers.get(channel)?.(message);
      return 1;
    });
    return value;
  }
  const pub = client();
  const sub = client();
  pub.duplicate = jest.fn(() => sub);
  (createClient as jest.Mock).mockReturnValue(pub);
  const config = new ConfigService({
    SOCKET_IO_REDIS_ENABLED: enabled,
    REDIS_URL: 'redis://127.0.0.1:16379',
    SOCKET_IO_REDIS_CHANNEL_PREFIX: 'friends-bingo:test',
  });
  const service = new SocketIoRedisService(config);
  return { service, pub, sub, config };
}

describe('Socket.IO Redis dependency safety', () => {
  let f: ReturnType<typeof fixture>;
  let server: Server | undefined;
  beforeEach(() => {
    jest.clearAllMocks();
    f = fixture();
  });
  afterEach(async () => {
    server?.close();
    server = undefined;
    await f.service.onApplicationShutdown();
    jest.useRealTimers();
  });

  it('disabled mode does not create clients or require Redis', async () => {
    f = fixture(false);
    await f.service.initialize();
    await f.service.verifyReady();
    expect(createClient).not.toHaveBeenCalled();
    expect(f.service.isReady()).toBe(true);
  });

  it('connects separate clients and waits for namespace subscription ACKs', async () => {
    await f.service.initialize();
    let release!: () => void;
    f.sub.pSubscribe.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    server = new Server(createServer());
    f.service.attach(server);
    server.of('/realtime');
    const ready = f.service.verifyReady();
    await Promise.resolve();
    expect(f.service.isReady()).toBe(false);
    release();
    await ready;
    expect(f.service.isReady()).toBe(true);
    expect(f.pub.duplicate).toHaveBeenCalledTimes(1);
    expect(f.pub.connect).toHaveBeenCalledTimes(1);
    expect(f.sub.connect).toHaveBeenCalledTimes(1);
    expect(f.sub.pSubscribe).toHaveBeenCalledWith(
      'friends-bingo:test#/realtime#*',
      expect.any(Function),
      true,
    );
  });

  it('bounds unavailable startup and destroys connecting clients', async () => {
    jest.useFakeTimers();
    f.pub.connect.mockImplementation(() => {
      f.pub.isOpen = true;
      return new Promise(() => {});
    });
    f.pub.close.mockImplementation(() => new Promise(() => {}));
    const startup = expect(f.service.initialize()).rejects.toThrow(
      'server will not listen',
    );
    await jest.advanceTimersByTimeAsync(12_001);
    await startup;
    expect(f.pub.destroy).toHaveBeenCalledTimes(1);
    expect(f.service.isReady()).toBe(false);
  });

  it('fails startup when a namespace subscription is denied', async () => {
    await f.service.initialize();
    f.sub.pSubscribe.mockRejectedValue(new Error('ACL denied'));
    server = new Server(createServer());
    f.service.attach(server);
    server.of('/realtime');
    await expect(f.service.verifyReady()).rejects.toThrow(
      'subscriptions are not ready',
    );
    expect(f.service.isReady()).toBe(false);
  });

  it.each(['pub', 'sub'] as const)(
    'closes transports on %s outage and probes restored subscriptions before recovery',
    async (connection) => {
      jest.useFakeTimers();
      await f.service.initialize();
      server = new Server(createServer());
      f.service.attach(server);
      server.of('/realtime');
      await f.service.verifyReady();
      const transport = Object.assign(new EventEmitter(), { close: jest.fn() });
      server.engine.emit('connection', transport as any);
      f[connection].isReady = false;
      f[connection].emit('reconnecting');
      expect(transport.close).toHaveBeenCalledWith(true);
      expect(f.service.isReady()).toBe(false);
      f[connection].isReady = true;
      f[connection].emit('ready');
      expect(f.service.isReady()).toBe(false);
      await jest.advanceTimersByTimeAsync(5000);
      expect(f.service.isReady()).toBe(true);
      expect(f.sub.pSubscribe.mock.calls.length).toBeGreaterThan(2);
      server.engine.emit('close');
    },
  );

  it('does not become ready merely because connections say ready; actual Pub/Sub must work', async () => {
    jest.useFakeTimers();
    await f.service.initialize();
    f.pub.publish.mockResolvedValue(0);
    const ready = expect(f.service.verifyReady()).rejects.toThrow(
      'subscriptions are not ready',
    );
    await jest.advanceTimersByTimeAsync(2001);
    await ready;
    expect(f.service.isReady()).toBe(false);
  });

  it('handles a rejected adapter publish without throwing into committed business work', async () => {
    await f.service.initialize();
    server = new Server(createServer());
    f.service.attach(server);
    const namespace = server.of('/realtime');
    await f.service.verifyReady();
    f.pub.publish.mockRejectedValueOnce(new Error('Disconnected'));
    expect(() =>
      namespace.to('session:one').emit('game:bingo_valid', { status: 'VALID' }),
    ).not.toThrow();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(f.service.isReady()).toBe(false);
  });

  it('suppresses all application broadcasts during degradation without throwing', async () => {
    const realtime = new RealtimeService(f.service);
    const broadcast = jest.fn();
    const all = jest.fn();
    realtime.setServer({ to: () => ({ emit: broadcast }), emit: all } as any);
    expect(() =>
      realtime.emitToSession('one', 'game:bingo_invalid', {
        status: 'INVALID',
      }),
    ).not.toThrow();
    realtime.emitToUser('one', 'game:bingo_claim_failed', {});
    realtime.emitToAllRealtimeClients('game:finished', {});
    expect(broadcast).not.toHaveBeenCalled();
    expect(all).not.toHaveBeenCalled();
    await expect(realtime.disconnectUser('one')).rejects.toThrow('unavailable');
    await f.service.initialize();
    await f.service.verifyReady();
    realtime.emitToSession('one', 'game:bingo_valid', { status: 'VALID' });
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('returns unhealthy readiness without misreporting a PostgreSQL failure', async () => {
    const prisma = { $queryRawUnsafe: jest.fn() };
    const health = new HealthService(prisma as any, f.config, f.service);
    await expect(health.getHealth()).rejects.toMatchObject({
      response: { realtimeRedis: 'down' },
    });
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('has bounded, idempotent shutdown and stops readiness polling', async () => {
    jest.useFakeTimers();
    await f.service.initialize();
    await f.service.verifyReady();
    const publishes = f.pub.publish.mock.calls.length;
    await f.service.onApplicationShutdown();
    await f.service.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(20_000);
    expect(f.pub.publish).toHaveBeenCalledTimes(publishes);
    expect(f.pub.close).toHaveBeenCalledTimes(1);
    expect(f.sub.close).toHaveBeenCalledTimes(1);
    expect(f.service.isReady()).toBe(false);
  });

  it('does not allow an old successful probe to erase a concurrent subscriber failure', async () => {
    jest.useFakeTimers();
    await f.service.initialize();
    await f.service.verifyReady();
    let release!: () => void;
    const publish = f.pub.publish.getMockImplementation()!;
    f.pub.publish.mockImplementationOnce(
      (channel, message) =>
        new Promise<void>((resolve) => {
          release = () => {
            publish(channel, message);
            resolve();
          };
        }),
    );
    await jest.advanceTimersByTimeAsync(5000);
    f.sub.emit('error', new Error('subscriber connection lost'));
    release();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(f.service.isReady()).toBe(false);
    await jest.advanceTimersByTimeAsync(5000);
    expect(f.service.isReady()).toBe(true);
  });

  it('attaching the same server twice does not duplicate adapters or subscription listeners', async () => {
    await f.service.initialize();
    server = new Server(createServer());
    f.service.attach(server);
    server.of('/realtime');
    await f.service.verifyReady();
    const subscriptions = f.sub.pSubscribe.mock.calls.length;
    const listeners = f.sub.listenerCount('error');
    f.service.attach(server);
    await f.service.verifyReady();
    expect(f.sub.pSubscribe).toHaveBeenCalledTimes(subscriptions);
    expect(f.sub.listenerCount('error')).toBe(listeners);
  });
});

describe('Redis environment validation', () => {
  // Validate just the new fields; no real environment or credentials are loaded.
  const schema = envValidationSchema.fork(
    Object.keys(envValidationSchema.describe().keys).filter(
      (key) =>
        ![
          'SOCKET_IO_REDIS_ENABLED',
          'REDIS_URL',
          'SOCKET_IO_REDIS_CHANNEL_PREFIX',
          'BINGO_CLAIM_RECOVERY_ENABLED',
        ].includes(key),
    ),
    (field) => field.optional(),
  );
  it('keeps both transport and orphan recovery disabled by default', () => {
    const { value, error } = schema.validate({ NODE_ENV: 'test' });
    expect(error).toBeUndefined();
    expect(value.SOCKET_IO_REDIS_ENABLED).toBe(false);
    expect(value.BINGO_CLAIM_RECOVERY_ENABLED).toBe(false);
  });
  it.each([
    { SOCKET_IO_REDIS_ENABLED: 'true' },
    {
      SOCKET_IO_REDIS_ENABLED: true,
      REDIS_URL: 'http://localhost',
      SOCKET_IO_REDIS_CHANNEL_PREFIX: 'bingo:test',
    },
    {
      SOCKET_IO_REDIS_ENABLED: true,
      REDIS_URL: 'redis://localhost:16379',
      SOCKET_IO_REDIS_CHANNEL_PREFIX: '*',
    },
  ])(
    'rejects incomplete or invalid enabled configuration: %#',
    (environment) => {
      expect(
        schema.validate({ NODE_ENV: 'test', ...environment }).error,
      ).toBeDefined();
    },
  );
  it('accepts Redis TLS and an explicit environment prefix', () => {
    expect(
      schema.validate({
        NODE_ENV: 'test',
        SOCKET_IO_REDIS_ENABLED: 'true',
        REDIS_URL: 'rediss://localhost:16379',
        SOCKET_IO_REDIS_CHANNEL_PREFIX: 'friends-bingo:staging',
      }).error,
    ).toBeUndefined();
  });
});
