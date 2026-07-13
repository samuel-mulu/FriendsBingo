import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Server } from 'socket.io';
import type { SessionCartelaChange } from '../games/games.mapper';
import {
  buildPublicCartelasSummaryPayload,
  buildSessionCartelasUpdatedPayload,
  createCartelasUpdatedBatch,
  mergeCartelasUpdatedPayload,
  SESSION_CARTELAS_BATCH_MS,
  type SessionCartelasUpdatedEmitPayload,
} from './session-cartelas-updated-batcher';

type MutableCartelasBatch = ReturnType<typeof createCartelasUpdatedBatch> & {
  timer: ReturnType<typeof setTimeout> | null;
};

const STATUS_FLUSH_EVENTS = new Set([
  'game:status_changed',
  'game:operation_updated',
  'game:cancelled',
  'game:finished',
]);

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private static readonly publicGamesRoom = 'games:public';
  private server: Server | null = null;
  private readonly cartelasBatches = new Map<string, MutableCartelasBatch>();

  // TODO: Replace the in-memory Socket.IO room strategy with a Redis adapter
  // when the API is scaled horizontally across multiple instances.

  setServer(server: Server): void {
    this.server = server;
  }

  onModuleDestroy(): void {
    for (const sessionId of [...this.cartelasBatches.keys()]) {
      this.flushPendingSessionCartelasUpdated(sessionId);
    }
  }

  emitToSession(sessionId: string, event: string, payload: unknown): void {
    if (STATUS_FLUSH_EVENTS.has(event)) {
      this.flushPendingSessionCartelasUpdated(sessionId);
    }

    this.emitToRoom(this.getSessionRoom(sessionId), event, payload);
  }

  // Backward-compatibility alias for older call sites/tests
  emitToGame(sessionId: string, event: string, payload: unknown): void {
    this.emitToSession(sessionId, event, payload);
  }

  emitToSlot(slotId: string, event: string, payload: unknown): void {
    this.emitToRoom(this.getSlotRoom(slotId), event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.emitToRoom(this.getUserRoom(userId), event, payload);
  }

  emitToAdmin(event: string, payload: unknown): void {
    this.emitToRoom('admin', event, payload);
  }

  emitToPublicGames(event: string, payload: unknown): void {
    this.emitToRoom(RealtimeService.publicGamesRoom, event, payload);
  }

  /** Reaches every connected player, including those in a live session room. */
  emitToAllRealtimeClients(event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.debug(
        `Skipping realtime event "${event}" for all clients because the gateway is not ready`,
      );
      return;
    }

    this.server.emit(event, payload);
  }

  emitGameOperationUpdate(payload: {
    slotId: string;
    sessionId: string | null;
    adminPayload: unknown;
    publicPayload: unknown;
  }): void {
    if (payload.sessionId) {
      this.flushPendingSessionCartelasUpdated(payload.sessionId);
    }

    this.emitToAdmin('game:operation_updated', payload.adminPayload);
    this.emitToPublicGames('game:operation_updated', payload.publicPayload);

    if (payload.sessionId) {
      this.emitToRoom(
        this.getSessionRoom(payload.sessionId),
        'game:operation_updated',
        payload.publicPayload,
      );
    }
  }

  emitSessionCartelasUpdated(payload: {
    sessionId: string;
    slotId: string;
    prizeAmount?: string;
    registeredCartelasCount?: number;
    changes?: SessionCartelaChange[];
  }): void {
    let batch = this.cartelasBatches.get(payload.sessionId);
    if (!batch) {
      batch = {
        ...createCartelasUpdatedBatch(payload),
        timer: null,
      };
      this.cartelasBatches.set(payload.sessionId, batch);
    } else {
      mergeCartelasUpdatedPayload(batch, payload);
    }

    if (!batch.timer) {
      batch.timer = setTimeout(() => {
        this.flushPendingSessionCartelasUpdated(payload.sessionId);
      }, SESSION_CARTELAS_BATCH_MS);
    }
  }

  flushPendingSessionCartelasUpdated(sessionId: string): void {
    const batch = this.cartelasBatches.get(sessionId);
    if (!batch) {
      return;
    }

    this.cartelasBatches.delete(sessionId);
    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }

    this.emitSessionCartelasUpdatedNow(buildSessionCartelasUpdatedPayload(batch));
  }

  emitGameFinished(payload: {
    sessionId: string;
    adminPayload: unknown;
    publicPayload: unknown;
  }): void {
    this.flushPendingSessionCartelasUpdated(payload.sessionId);

    this.emitToRoom(
      this.getSessionRoom(payload.sessionId),
      'game:finished',
      payload.publicPayload,
    );
    this.emitToAdmin('game:finished', payload.adminPayload);
    this.emitToPublicGames('game:finished', payload.publicPayload);
  }

  emitGameCancelled(payload: { sessionId: string; payload: unknown }): void {
    this.flushPendingSessionCartelasUpdated(payload.sessionId);

    this.emitToRoom(
      this.getSessionRoom(payload.sessionId),
      'game:cancelled',
      payload.payload,
    );
    this.emitToAdmin('game:cancelled', payload.payload);
    this.emitToPublicGames('game:cancelled', payload.payload);
  }

  getSessionRoom(sessionId: string): string {
    return `session:${sessionId}`;
  }

  getSlotRoom(slotId: string): string {
    return `slot:${slotId}`;
  }

  getUserRoom(userId: string): string {
    return `user:${userId}`;
  }

  getPublicGamesRoom(): string {
    return RealtimeService.publicGamesRoom;
  }

  private emitSessionCartelasUpdatedNow(
    payload: SessionCartelasUpdatedEmitPayload,
  ): void {
    const publicPayload = buildPublicCartelasSummaryPayload(payload);

    this.emitToRoom(
      this.getSessionRoom(payload.sessionId),
      'session:cartelas_updated',
      payload,
    );
    this.emitToRoom(
      this.getSlotRoom(payload.slotId),
      'session:cartelas_updated',
      payload,
    );
    this.emitToRoom(
      RealtimeService.publicGamesRoom,
      'session:cartelas_updated',
      publicPayload,
    );
  }

  private emitToRoom(room: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.debug(
        `Skipping realtime event "${event}" for room "${room}" because the gateway is not ready`,
      );
      return;
    }

    this.server.to(room).emit(event, payload);
  }
}
