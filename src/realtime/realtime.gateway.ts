import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { GameStatus, UserRole, UserStatus } from '@prisma/client';
import { isUUID } from 'class-validator';
import type { Server, Socket } from 'socket.io';
import { JwtPayload } from '../common/types/jwt-payload.type';
import { readCorsOriginsFromEnv, resolveWebSocketCorsOptions } from '../config/cors.config';
import { parseCorsOrigins } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from './realtime.service';
import { RealtimeUser } from './types/realtime-user.type';

interface GameRoomPayload {
  sessionId: string;
}

type AuthenticatedSocket = Socket & {
  data: {
    user?: RealtimeUser;
    disconnectLoggerRegistered?: boolean;
    disconnectReason?: string;
  };
};

@WebSocketGateway({
  namespace: '/realtime',
  path: '/socket.io',
  cors: {
    origin: resolveWebSocketCorsOptions(readCorsOriginsFromEnv()),
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtimeService.setServer(server);
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    this.registerDisconnectLogger(client);

    this.logger.log(
      `Socket connection attempt origin=${this.getOrigin(client)} namespace=${client.nsp.name} tokenExists=${this.hasToken(client)}`,
    );

    if (!this.isOriginAllowed(client)) {
      this.logger.warn(
        `Socket connection rejected origin=${this.getOrigin(client)} namespace=${client.nsp.name} reason=origin_not_allowed`,
      );
      client.disconnect(true);
      throw new WsException('Origin not allowed');
    }

    const token = this.extractToken(client);

    if (!token) {
      await client.join(this.realtimeService.getPublicGamesRoom());
      this.logger.log(
        `Socket connection guest origin=${this.getOrigin(client)} namespace=${client.nsp.name} room=${this.realtimeService.getPublicGamesRoom()}`,
      );
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          role: true,
          phoneNumber: true,
          status: true,
        },
      });

      if (!user || user.status !== UserStatus.ACTIVE) {
        this.logger.warn(
          `Socket connection rejected origin=${this.getOrigin(client)} namespace=${client.nsp.name} tokenExists=true reason=inactive_or_missing_user`,
        );
        client.disconnect(true);
        throw new WsException('Unauthorized');
      }

      client.data.user = {
        userId: user.id,
        role: user.role,
        phoneNumber: user.phoneNumber,
      };

      await client.join(this.realtimeService.getUserRoom(user.id));
      await client.join(this.realtimeService.getPublicGamesRoom());

      if (user.role === UserRole.ADMIN) {
        await client.join('admin');
      }

      this.logger.log(
        `Socket connection authenticated origin=${this.getOrigin(client)} namespace=${client.nsp.name} tokenExists=true userId=${user.id}`,
      );
    } catch (error) {
      this.logger.warn(
        `Socket authentication failed origin=${this.getOrigin(client)} namespace=${client.nsp.name} tokenExists=true error=${this.toSafeError(error)}`,
      );
      client.disconnect(true);
      throw new WsException('Unauthorized');
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.logger.log(
      `Socket disconnected namespace=${client.nsp.name} userId=${client.data.user?.userId ?? 'anonymous'} reason=${client.data.disconnectReason ?? 'unknown'}`,
    );
  }

  @SubscribeMessage('game:join')
  async handleGameJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: GameRoomPayload,
  ) {
    const user = this.requireUser(client);

    if (!payload?.sessionId || !isUUID(payload.sessionId)) {
      throw new WsException('sessionId is required');
    }

    const canJoin = await this.canJoinGameRoom(user, payload.sessionId);
    if (!canJoin) {
      throw new WsException('Not allowed to join this session room');
    }

    await client.join(this.realtimeService.getSessionRoom(payload.sessionId));
    return {
      joined: true,
      room: this.realtimeService.getSessionRoom(payload.sessionId),
    };
  }

  @SubscribeMessage('game:leave')
  async handleGameLeave(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: GameRoomPayload,
  ) {
    this.requireUser(client);

    if (!payload?.sessionId || !isUUID(payload.sessionId)) {
      throw new WsException('sessionId is required');
    }

    await client.leave(this.realtimeService.getSessionRoom(payload.sessionId));
    return {
      left: true,
      room: this.realtimeService.getSessionRoom(payload.sessionId),
    };
  }

  private requireUser(client: AuthenticatedSocket): RealtimeUser {
    const user = client.data.user;
    if (!user) {
      throw new WsException('Unauthorized');
    }

    return user;
  }

  private extractToken(client: AuthenticatedSocket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.replace(/^Bearer\s+/i, '').trim();
    }

    const headerAuth = client.handshake.headers.authorization;
    if (typeof headerAuth === 'string' && headerAuth.trim()) {
      return headerAuth.replace(/^Bearer\s+/i, '').trim();
    }

    return null;
  }

  private hasToken(client: AuthenticatedSocket): boolean {
    return this.extractToken(client) !== null;
  }

  private async canJoinGameRoom(
    user: RealtimeUser,
    sessionId: string,
  ): Promise<boolean> {
    if (user.role === UserRole.ADMIN) {
      const session = await this.prisma.gameSession.findUnique({
        where: { id: sessionId },
        select: { id: true },
      });

      return Boolean(session);
    }

    const registeredCartela = await this.prisma.gameCartela.findFirst({
      where: {
        gameSessionId: sessionId,
        userId: user.userId,
      },
      select: { id: true },
    });

    if (registeredCartela) {
      return true;
    }

    const publicSession = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true },
    });

    const viewableStatuses: GameStatus[] = [
      GameStatus.NEXT,
      GameStatus.CHECKING,
      GameStatus.PLAYING,
      GameStatus.WINNER_WINDOW,
      GameStatus.FINISHED,
    ];

    return Boolean(
      publicSession && viewableStatuses.includes(publicSession.status),
    );
  }

  private isOriginAllowed(client: AuthenticatedSocket): boolean {
    const origin = client.handshake.headers.origin;
    const corsOrigins = this.configService.getOrThrow<string>('CORS_ORIGINS');
    const allowedOrigins = parseCorsOrigins(corsOrigins);

    if (typeof origin !== 'string' || !origin.trim()) {
      return allowedOrigins === true;
    }

    if (allowedOrigins === true) {
      return true;
    }

    return Array.isArray(allowedOrigins)
      ? allowedOrigins.includes(origin.trim())
      : false;
  }

  private getOrigin(client: AuthenticatedSocket): string {
    const origin = client.handshake.headers.origin;
    return typeof origin === 'string' && origin.trim()
      ? origin.trim()
      : 'unknown';
  }

  private registerDisconnectLogger(client: AuthenticatedSocket): void {
    if (client.data.disconnectLoggerRegistered) {
      return;
    }

    client.data.disconnectLoggerRegistered = true;
    client.on('disconnect', (reason) => {
      client.data.disconnectReason = reason;
    });
  }

  private toSafeError(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return String(error);
  }
}
