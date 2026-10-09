import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import type { Server } from 'socket.io';

const STARTUP_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 2_000;
const HEALTH_INTERVAL_MS = 5_000;
type RedisClient = ReturnType<typeof createClient>;

@Injectable()
export class SocketIoRedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(SocketIoRedisService.name);
  readonly enabled: boolean;
  private pub?: RedisClient;
  private sub?: RedisClient;
  private factory?: ReturnType<typeof createAdapter>;
  private ready = false;
  private stopping = false;
  private generation = 0;
  private timer?: ReturnType<typeof setInterval>;
  private checking?: Promise<boolean>;
  private readonly servers = new Set<Server>();
  private readonly transports = new Set<{
    close(discard?: boolean): unknown;
  }>();
  private readonly subscriptions: Array<() => Promise<unknown>> = [];
  private readonly pendingSubscriptions = new Set<Promise<unknown>>();
  private readonly probeChannel: string;
  private probeReceived?: (message: string) => void;

  constructor(private readonly config: ConfigService) {
    const enabled = config.get<boolean | string>('SOCKET_IO_REDIS_ENABLED');
    this.enabled = enabled === true || enabled === 'true';
    this.probeChannel = `${config.get<string>('SOCKET_IO_REDIS_CHANNEL_PREFIX')}:readiness:${randomUUID()}`;
  }

  isReady(): boolean {
    return (
      !this.enabled ||
      (!this.stopping &&
        this.ready &&
        !!this.pub?.isReady &&
        !!this.sub?.isReady)
    );
  }

  async initialize(): Promise<void> {
    if (!this.enabled || this.factory) return;
    const url = this.config.get<string>('REDIS_URL');
    const prefix = this.config.get<string>('SOCKET_IO_REDIS_CHANNEL_PREFIX');
    if (!url || !prefix)
      throw new Error('Socket.IO Redis configuration is incomplete');
    const instanceId = randomUUID();
    this.pub = createClient({
      url,
      name: `${prefix}:pub:${instanceId}`,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 1000,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (retries) =>
          Math.min(250 * 2 ** Math.min(retries, 3), 2000),
      },
    });
    this.sub = this.pub.duplicate({ name: `${prefix}:sub:${instanceId}` });
    for (const client of [this.pub, this.sub]) {
      // Never log the raw Redis error: it can contain connection credentials.
      client.on('error', () => this.degrade());
      client.on('reconnecting', () => this.degrade());
      client.on('end', () => this.degrade());
    }
    try {
      await this.bounded(
        Promise.all([this.pub.connect(), this.sub.connect()]),
        STARTUP_TIMEOUT_MS,
      );
      await this.bounded(
        this.sub.subscribe(this.probeChannel, (message) =>
          this.probeReceived?.(message),
        ),
        PROBE_TIMEOUT_MS,
      );
      this.factory = createAdapter(
        this.adapterClient(this.pub, false),
        this.adapterClient(this.sub, true),
        { key: prefix },
      );
    } catch {
      await this.onApplicationShutdown();
      throw new Error('Socket.IO Redis startup failed; server will not listen');
    }
  }

  attach(server: Server): void {
    if (!this.factory)
      throw new Error(
        'Socket.IO Redis must be initialized before attaching the adapter',
      );
    if (this.servers.has(server)) return;
    this.servers.add(server);
    server.engine?.on('connection', (transport) => {
      this.transports.add(transport);
      transport.once('close', () => this.transports.delete(transport));
    });
    server.adapter(this.factory);
  }

  // Call after app.init() creates namespaces, but before app.listen().
  async verifyReady(): Promise<void> {
    if (!this.enabled) return;
    if (!(await this.checkReadiness()))
      throw new Error(
        'Socket.IO Redis subscriptions are not ready; server will not listen',
      );
    if (!this.timer) {
      this.timer = setInterval(
        () => void this.checkReadiness(),
        HEALTH_INTERVAL_MS,
      );
      this.timer.unref();
    }
  }

  private checkReadiness(): Promise<boolean> {
    if (this.checking) return this.checking;
    this.checking = this.probe().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  private async probe(): Promise<boolean> {
    if (this.stopping || !this.pub?.isReady || !this.sub?.isReady) {
      this.degrade();
      return false;
    }
    const generation = this.generation;
    try {
      await this.bounded(
        Promise.all([...this.pendingSubscriptions]),
        PROBE_TIMEOUT_MS,
      );
      // node-redis 6 restores its subscriptions before emitting ready. Reapply
      // the same listeners as well, including any rejected namespace setup.
      if (!this.ready) {
        await this.bounded(
          Promise.all(this.subscriptions.map((subscribe) => subscribe())),
          PROBE_TIMEOUT_MS,
        );
      }
      const nonce = randomUUID();
      const received = new Promise<void>((resolve) => {
        this.probeReceived = (message) => {
          if (message === nonce) resolve();
        };
      });
      await this.bounded(
        Promise.all([received, this.pub.publish(this.probeChannel, nonce)]),
        PROBE_TIMEOUT_MS,
      );
      if (this.stopping || generation !== this.generation) return false;
      if (!this.ready)
        this.logger.log('Socket.IO Redis ready; Pub/Sub verified');
      this.ready = true;
      return true;
    } catch {
      this.degrade();
      return false;
    } finally {
      this.probeReceived = undefined;
    }
  }

  private degrade(): void {
    this.generation++;
    if (this.ready && !this.stopping) {
      this.logger.warn(
        'Socket.IO Redis unavailable; realtime transports closed, HTTP reconciliation remains available',
      );
    }
    this.ready = false;
    // Transport close permits normal client reconnection. Namespace-level
    // disconnect(true) would prevent automatic Socket.IO reconnection.
    for (const client of this.transports) client.close(true);
  }

  private adapterClient(client: RedisClient, subscriber: boolean): RedisClient {
    return new Proxy(client, {
      get: (target, property) => {
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        const method = value.bind(target);
        if (
          ![
            'publish',
            'subscribe',
            'pSubscribe',
            'unsubscribe',
            'pUnsubscribe',
          ].includes(String(property))
        )
          return method;
        return (...args: unknown[]) => {
          if (
            subscriber &&
            ['subscribe', 'pSubscribe'].includes(String(property))
          ) {
            const subscribe = () => method(...args);
            this.subscriptions.push(subscribe);
            const pending = Promise.resolve().then(subscribe);
            this.pendingSubscriptions.add(pending);
            // Adapter 8.3 does not await these command promises. Always handle
            // rejection without throwing into an already-committed game result.
            void pending
              .catch(() => this.degrade())
              .finally(() => this.pendingSubscriptions.delete(pending));
            return pending.catch(() => undefined);
          }
          return Promise.resolve()
            .then(() => method(...args))
            .catch(() => {
              if (!this.stopping) this.degrade();
              return property === 'publish' ? 0 : undefined;
            });
        };
      },
    });
  }

  private async bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Socket.IO Redis operation timed out')),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout!);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.degrade();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.all(
      [this.pub, this.sub].map(async (client) => {
        if (!client?.isOpen) return;
        try {
          await this.bounded(client.close(), PROBE_TIMEOUT_MS);
        } catch {
          if (client.isOpen) client.destroy();
        }
      }),
    );
  }
}
