import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
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
import { parseCorsOrigins } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from './realtime.service';
import { RealtimeUser } from './types/realtime-user.type';

interface GameRoomPayload {
  gameId: string;
}

type AuthenticatedSocket = Socket & {
  data: {
    user?: RealtimeUser;
  };
};

@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: '*',
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
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
    if (!this.isOriginAllowed(client)) {
      client.disconnect(true);
      throw new WsException('Origin not allowed');
    }

    const token = this.extractToken(client);

    if (!token) {
      client.disconnect(true);
      throw new WsException('Unauthorized');
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
        client.disconnect(true);
        throw new WsException('Unauthorized');
      }

      client.data.user = {
        userId: user.id,
        role: user.role,
        phoneNumber: user.phoneNumber,
      };

      await client.join(this.realtimeService.getUserRoom(user.id));

      if (user.role === UserRole.ADMIN) {
        await client.join('admin');
      }
    } catch (error) {
      this.logger.debug(`Socket authentication failed: ${String(error)}`);
      client.disconnect(true);
      throw new WsException('Unauthorized');
    }
  }

  @SubscribeMessage('game:join')
  async handleGameJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: GameRoomPayload,
  ) {
    const user = this.requireUser(client);

    if (!payload?.gameId || !isUUID(payload.gameId)) {
      throw new WsException('gameId is required');
    }

    const canJoin = await this.canJoinGameRoom(user, payload.gameId);
    if (!canJoin) {
      throw new WsException('Not allowed to join this game room');
    }

    await client.join(this.realtimeService.getGameRoom(payload.gameId));
    return { joined: true, room: this.realtimeService.getGameRoom(payload.gameId) };
  }

  @SubscribeMessage('game:leave')
  async handleGameLeave(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: GameRoomPayload,
  ) {
    this.requireUser(client);

    if (!payload?.gameId || !isUUID(payload.gameId)) {
      throw new WsException('gameId is required');
    }

    await client.leave(this.realtimeService.getGameRoom(payload.gameId));
    return { left: true, room: this.realtimeService.getGameRoom(payload.gameId) };
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

  private async canJoinGameRoom(
    user: RealtimeUser,
    gameId: string,
  ): Promise<boolean> {
    if (user.role === UserRole.ADMIN) {
      const game = await this.prisma.game.findUnique({
        where: { id: gameId },
        select: { id: true },
      });

      return Boolean(game);
    }

    const registeredCartela = await this.prisma.gameCartela.findFirst({
      where: {
        gameId,
        userId: user.userId,
      },
      select: { id: true },
    });

    if (registeredCartela) {
      return true;
    }

    const publicGame = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { id: true, status: true },
    });

    const viewableStatuses: GameStatus[] = [
      GameStatus.NEXT,
      GameStatus.CHECKING,
      GameStatus.PLAYING,
      GameStatus.FINISHED,
    ];

    return Boolean(publicGame && viewableStatuses.includes(publicGame.status));
  }

  private isOriginAllowed(client: AuthenticatedSocket): boolean {
    const origin = client.handshake.headers.origin;
    if (typeof origin !== 'string' || !origin.trim()) {
      return true;
    }

    const corsOrigins = this.configService.get<string>('CORS_ORIGINS');
    if (!corsOrigins) {
      return true;
    }

    const allowedOrigins = parseCorsOrigins(corsOrigins);
    if (allowedOrigins === true) {
      return true;
    }

    return Array.isArray(allowedOrigins)
      ? allowedOrigins.includes(origin.trim())
      : false;
  }
}
