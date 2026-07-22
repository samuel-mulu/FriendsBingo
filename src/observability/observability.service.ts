import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';
import type { Server } from 'socket.io';
import { RequestContextService } from './request-context.service';

type SocketAuthType = 'authenticated' | 'guest';
type ReconnectScope = 'user' | 'device';
type PoolName = 'query' | 'transaction';
type RoomType =
  | 'admin'
  | 'other'
  | 'public_games'
  | 'session'
  | 'slot'
  | 'user';

interface SocketTrackingState {
  authType: SocketAuthType;
  deviceKey?: string;
  userKey?: string;
}

const ROOM_TYPES: readonly RoomType[] = [
  'public_games',
  'session',
  'slot',
  'user',
  'admin',
  'other',
];
const SOCKET_RECONNECT_WINDOW_MS = 60_000;
const ACTIVE_GAME_STATUSES = [
  'NEXT',
  'READY',
  'PLAYING',
  'CHECKING',
  'WINNER_WINDOW',
];

@Injectable()
export class ObservabilityService {
  readonly contentType: string;
  readonly prismaSlowQueryThresholdMs: number;

  private readonly logger = new Logger(ObservabilityService.name);
  private readonly registry = new Registry();
  private readonly activeSockets = new Map<string, SocketTrackingState>();
  private readonly lastDisconnectByDeviceKey = new Map<string, number>();
  private readonly lastDisconnectByUserKey = new Map<string, number>();
  private readonly pgPools = new Map<PoolName, Pool>();
  private socketServer: Server | null = null;

  private readonly httpRequestsTotal = new Counter({
    name: 'friends_bingo_http_requests_total',
    help: 'Total HTTP requests.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  private readonly httpRequestDuration = new Histogram({
    name: 'friends_bingo_http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  private readonly httpRequestsActive = new Gauge({
    name: 'friends_bingo_http_requests_active',
    help: 'Current in-flight HTTP requests.',
    registers: [this.registry],
  });

  private readonly operationsCurrentRequestsTotal = new Counter({
    name: 'friends_bingo_operations_current_requests_total',
    help: 'Total requests to GET /games/operations/current.',
    registers: [this.registry],
  });

  private readonly operationsCurrentRequestsActive = new Gauge({
    name: 'friends_bingo_operations_current_requests_active',
    help: 'Current in-flight requests to GET /games/operations/current.',
    registers: [this.registry],
  });

  private readonly registrationStateResponseSize = new Histogram({
    name: 'friends_bingo_registration_state_response_size_bytes',
    help: 'Registration-state response size in bytes.',
    labelNames: ['view'] as const,
    buckets: [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072],
    registers: [this.registry],
  });

  private readonly socketConnectionsActive = new Gauge({
    name: 'friends_bingo_socket_connections_active',
    help: 'Current active Socket.IO connections.',
    registers: [this.registry],
  });

  private readonly socketConnectionsByAuth = new Gauge({
    name: 'friends_bingo_socket_connections_by_auth',
    help: 'Current active Socket.IO connections by auth state.',
    labelNames: ['auth'] as const,
    registers: [this.registry],
  });

  private readonly socketConnectionsTotal = new Counter({
    name: 'friends_bingo_socket_connections_total',
    help: 'Total Socket.IO connections.',
    labelNames: ['auth'] as const,
    registers: [this.registry],
  });

  private readonly socketDisconnectionsTotal = new Counter({
    name: 'friends_bingo_socket_disconnections_total',
    help: 'Total Socket.IO disconnections by reason.',
    labelNames: ['auth', 'reason'] as const,
    registers: [this.registry],
  });

  private readonly socketReconnectsTotal = new Counter({
    name: 'friends_bingo_socket_reconnects_total',
    help: 'Detected Socket.IO reconnects.',
    labelNames: ['auth', 'detected_by'] as const,
    registers: [this.registry],
  });

  private readonly socketRoomsActive = new Gauge({
    name: 'friends_bingo_socket_rooms_active',
    help: 'Active Socket.IO rooms by normalized room type.',
    labelNames: ['room_type'] as const,
    registers: [this.registry],
  });

  private readonly socketRoomMembers = new Gauge({
    name: 'friends_bingo_socket_room_members',
    help: 'Socket.IO room members aggregated by normalized room type.',
    labelNames: ['room_type'] as const,
    registers: [this.registry],
  });

  private readonly prismaQueryDuration = new Histogram({
    name: 'friends_bingo_prisma_query_duration_seconds',
    help: 'Prisma query duration in seconds.',
    labelNames: ['model', 'action'] as const,
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly prismaSlowQueriesTotal = new Counter({
    name: 'friends_bingo_prisma_slow_queries_total',
    help: 'Total Prisma slow queries above the configured threshold.',
    labelNames: ['model', 'action'] as const,
    registers: [this.registry],
  });

  private readonly postgresPoolClients = new Gauge({
    name: 'friends_bingo_postgres_pool_clients',
    help: 'PostgreSQL pool client counts by pool and state.',
    labelNames: ['pool', 'state'] as const,
    registers: [this.registry],
  });

  private readonly pushBatchDuration = new Histogram({
    name: 'friends_bingo_push_batch_duration_seconds',
    help: 'Push notification batch duration in seconds.',
    labelNames: ['operation'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [this.registry],
  });

  private readonly pushDeliveriesTotal = new Counter({
    name: 'friends_bingo_push_deliveries_total',
    help: 'Push notification delivery attempts by result.',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  private readonly activeGameSlots = new Gauge({
    name: 'friends_bingo_game_slots_active',
    help: 'Current active game slot count.',
    registers: [this.registry],
  });

  private readonly activeGameSessions = new Gauge({
    name: 'friends_bingo_game_sessions_active',
    help: 'Current active game session count.',
    registers: [this.registry],
  });

  constructor(private readonly requestContext: RequestContextService) {
    this.prismaSlowQueryThresholdMs = resolveSlowQueryThresholdMs();
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'friends_bingo_',
      eventLoopMonitoringPrecision: 20,
    });
    this.contentType = this.registry.contentType;
  }

  recordHttpRequest(params: {
    durationSeconds: number;
    method: string;
    route: string;
    statusCode: number;
  }): void {
    const method = normalizeMethod(params.method);
    const route = normalizeRouteLabel(params.route);
    const status = String(params.statusCode);

    this.httpRequestsTotal.inc({ method, route, status });
    this.httpRequestDuration.observe(
      { method, route, status },
      params.durationSeconds,
    );

    if (route === '/games/operations/current') {
      this.operationsCurrentRequestsTotal.inc();
    }
  }

  incrementActiveHttpRequests(): void {
    this.httpRequestsActive.inc();
  }

  decrementActiveHttpRequests(): void {
    this.httpRequestsActive.dec();
  }

  incrementOperationsCurrentActiveRequests(): void {
    this.operationsCurrentRequestsActive.inc();
  }

  decrementOperationsCurrentActiveRequests(): void {
    this.operationsCurrentRequestsActive.dec();
  }

  recordRegistrationStateResponseSize(bytes: number, view: string): void {
    this.registrationStateResponseSize.observe(
      { view: normalizeRegistrationView(view) },
      bytes,
    );
  }

  recordPrismaQuery(model: string, action: string, durationMs: number): void {
    const normalizedModel = sanitizeMetricLabel(model);
    const normalizedAction = sanitizeMetricLabel(action);

    this.prismaQueryDuration.observe(
      {
        model: normalizedModel,
        action: normalizedAction,
      },
      Math.max(durationMs, 0) / 1000,
    );

    if (durationMs >= this.prismaSlowQueryThresholdMs) {
      this.prismaSlowQueriesTotal.inc({
        model: normalizedModel,
        action: normalizedAction,
      });
      this.logger.warn(
        `requestId=${this.requestContext.getRequestIdForLog()} Prisma slow query model=${normalizedModel} action=${normalizedAction} durationMs=${Math.round(durationMs)}`,
      );
    }
  }

  bindPgPools(pools: { query: Pool; transaction: Pool }): void {
    this.pgPools.set('query', pools.query);
    this.pgPools.set('transaction', pools.transaction);
  }

  bindSocketServer(server: Server): void {
    this.socketServer = server;
  }

  recordSocketConnected(params: {
    authType: SocketAuthType;
    deviceId?: string | null;
    socketId: string;
    userId?: string | null;
  }): void {
    const authType = params.authType;
    const userKey = params.userId ? `user:${params.userId}` : undefined;
    const deviceKey = params.deviceId ? `device:${params.deviceId}` : undefined;
    const now = Date.now();

    this.detectReconnect(authType, now, userKey, 'user');
    this.detectReconnect(authType, now, deviceKey, 'device');

    this.activeSockets.set(params.socketId, {
      authType,
      userKey,
      deviceKey,
    });
    this.socketConnectionsActive.inc();
    this.socketConnectionsByAuth.inc({ auth: authType });
    this.socketConnectionsTotal.inc({ auth: authType });
  }

  recordSocketDisconnected(socketId: string, reason: string): void {
    const tracking = this.activeSockets.get(socketId);
    const authType = tracking?.authType ?? 'guest';
    const now = Date.now();

    if (tracking) {
      this.activeSockets.delete(socketId);
      this.socketConnectionsActive.dec();
      this.socketConnectionsByAuth.dec({ auth: tracking.authType });

      if (tracking.userKey) {
        this.lastDisconnectByUserKey.set(tracking.userKey, now);
      }

      if (tracking.deviceKey) {
        this.lastDisconnectByDeviceKey.set(tracking.deviceKey, now);
      }
    }

    this.socketDisconnectionsTotal.inc({
      auth: authType,
      reason: sanitizeMetricLabel(reason || 'unknown'),
    });
  }

  startPushBatch(operation: string): () => void {
    const stopTimer = this.pushBatchDuration.startTimer({
      operation: sanitizeMetricLabel(operation),
    });
    return () => stopTimer();
  }

  recordPushDelivery(result: 'failure' | 'success', count = 1): void {
    if (count <= 0) {
      return;
    }

    this.pushDeliveriesTotal.inc({ result }, count);
  }

  async getMetrics(): Promise<string> {
    await this.collectSnapshotMetrics();
    return this.registry.metrics();
  }

  private async collectSnapshotMetrics(): Promise<void> {
    await Promise.all([
      this.collectActiveGameMetrics(),
      this.collectPgPoolMetrics(),
      this.collectSocketRoomMetrics(),
    ]);
  }

  private async collectActiveGameMetrics(): Promise<void> {
    const pool = this.pgPools.get('query');
    if (!pool) {
      return;
    }

    try {
      const [slotResult, sessionResult] = await Promise.all([
        pool.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM "GameSlot" WHERE "status" = ANY($1::text[])',
          [ACTIVE_GAME_STATUSES],
        ),
        pool.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM "GameSession" WHERE "status" = ANY($1::text[])',
          [ACTIVE_GAME_STATUSES],
        ),
      ]);

      this.activeGameSlots.set(Number(slotResult.rows[0]?.count ?? 0));
      this.activeGameSessions.set(Number(sessionResult.rows[0]?.count ?? 0));
    } catch (error) {
      this.logger.warn(
        `Failed to collect active game metrics: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async collectPgPoolMetrics(): Promise<void> {
    this.postgresPoolClients.reset();

    for (const [poolName, pool] of this.pgPools.entries()) {
      this.postgresPoolClients.set(
        { pool: poolName, state: 'total' },
        pool.totalCount,
      );
      this.postgresPoolClients.set(
        { pool: poolName, state: 'idle' },
        pool.idleCount,
      );
      this.postgresPoolClients.set(
        { pool: poolName, state: 'waiting' },
        pool.waitingCount,
      );
    }
  }

  private async collectSocketRoomMetrics(): Promise<void> {
    this.socketRoomsActive.reset();
    this.socketRoomMembers.reset();

    for (const roomType of ROOM_TYPES) {
      this.socketRoomsActive.set({ room_type: roomType }, 0);
      this.socketRoomMembers.set({ room_type: roomType }, 0);
    }

    const server = this.socketServer;
    if (!server) {
      return;
    }

    const roomCounts = new Map<RoomType, number>();
    const memberCounts = new Map<RoomType, number>();
    for (const roomType of ROOM_TYPES) {
      roomCounts.set(roomType, 0);
      memberCounts.set(roomType, 0);
    }

    for (const [roomName, members] of server.sockets.adapter.rooms.entries()) {
      if (server.sockets.adapter.sids.has(roomName)) {
        continue;
      }

      const roomType = this.resolveRoomType(roomName);
      roomCounts.set(roomType, (roomCounts.get(roomType) ?? 0) + 1);
      memberCounts.set(
        roomType,
        (memberCounts.get(roomType) ?? 0) + members.size,
      );
    }

    for (const roomType of ROOM_TYPES) {
      this.socketRoomsActive.set(
        { room_type: roomType },
        roomCounts.get(roomType) ?? 0,
      );
      this.socketRoomMembers.set(
        { room_type: roomType },
        memberCounts.get(roomType) ?? 0,
      );
    }
  }

  private detectReconnect(
    authType: SocketAuthType,
    now: number,
    key: string | undefined,
    scope: ReconnectScope,
  ): void {
    if (!key) {
      return;
    }

    const sourceMap =
      scope === 'device'
        ? this.lastDisconnectByDeviceKey
        : this.lastDisconnectByUserKey;
    const lastDisconnectedAt = sourceMap.get(key);
    if (
      lastDisconnectedAt != null &&
      now - lastDisconnectedAt <= SOCKET_RECONNECT_WINDOW_MS
    ) {
      this.socketReconnectsTotal.inc({
        auth: authType,
        detected_by: scope,
      });
    }
  }

  private resolveRoomType(roomName: string): RoomType {
    if (roomName === 'games:public') {
      return 'public_games';
    }

    if (roomName === 'admin') {
      return 'admin';
    }

    if (roomName.startsWith('session:')) {
      return 'session';
    }

    if (roomName.startsWith('slot:')) {
      return 'slot';
    }

    if (roomName.startsWith('user:')) {
      return 'user';
    }

    return 'other';
  }
}

function normalizeMethod(method: string): string {
  return method.trim().toUpperCase() || 'UNKNOWN';
}

function normalizeRouteLabel(route: string): string {
  const normalized = route.trim();
  return normalized || 'unmatched';
}

function normalizeRegistrationView(view: string): string {
  if (view === 'slim' || view === 'full') {
    return view;
  }

  return 'unknown';
}

function sanitizeMetricLabel(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return 'unknown';
  }

  return trimmed.replace(/[^a-z0-9_:/.-]+/g, '_').slice(0, 64) || 'unknown';
}

function resolveSlowQueryThresholdMs(): number {
  const raw = Number(process.env.PRISMA_SLOW_QUERY_THRESHOLD_MS ?? 250);
  return Number.isFinite(raw) && raw > 0 ? raw : 250;
}
