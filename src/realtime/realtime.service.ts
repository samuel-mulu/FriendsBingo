import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private static readonly publicGamesRoom = 'games:public';
  private server: Server | null = null;

  // TODO: Replace the in-memory Socket.IO room strategy with a Redis adapter
  // when the API is scaled horizontally across multiple instances.

  setServer(server: Server): void {
    this.server = server;
  }

  emitToGame(gameId: string, event: string, payload: unknown): void {
    this.emitToRoom(this.getGameRoom(gameId), event, payload);
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

  getGameRoom(gameId: string): string {
    return `game:${gameId}`;
  }

  getUserRoom(userId: string): string {
    return `user:${userId}`;
  }

  getPublicGamesRoom(): string {
    return RealtimeService.publicGamesRoom;
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
