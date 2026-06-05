import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GameStatus, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/services/audit-log.service';
import { GameQueueService } from '../games/game-queue.service';
import { serializeGame } from '../games/games.mapper';
import { gameSummarySelect } from '../games/games.select';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

type PrismaDbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class GameEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
    private readonly gameQueueService: GameQueueService,
  ) {}

  async startGame(gameId: string, actorId?: string) {
    const startedAt = new Date();

    const game = await this.prisma.$transaction(async (tx) => {
      const existingGame = await tx.game.findUnique({
        where: { id: gameId },
        select: {
          id: true,
          status: true,
        },
      });

      if (!existingGame) {
        throw new NotFoundException('Game not found');
      }

      await this.gameQueueService.assertHeadNextGame(tx, gameId);

      const updateResult = await tx.game.updateMany({
        where: {
          id: gameId,
          status: GameStatus.NEXT,
        },
        data: {
          status: GameStatus.PLAYING,
          startedAt,
        },
      });

      if (updateResult.count !== 1) {
        throw new BadRequestException('Game could not be started');
      }

      await this.gameQueueService.compactNextQueue(tx);

      if (actorId) {
        await this.auditLogService.create(tx, {
          actorId,
          action: 'admin.game.start',
          entity: 'Game',
          entityId: gameId,
          metadata: {
            startedAt: startedAt.toISOString(),
          },
        });
      }

      const updatedGame = await tx.game.findUnique({
        where: { id: gameId },
        select: gameSummarySelect,
      });

      if (!updatedGame) {
        throw new NotFoundException('Game not found after start');
      }

      return updatedGame;
    });

    const payload = serializeGame(game);
    this.realtimeService.emitToGame(game.id, 'game:status_changed', payload);
    this.realtimeService.emitToAdmin('game:status_changed', payload);
    this.realtimeService.emitToPublicGames('game:status_changed', payload);

    return payload;
  }

  async finishGameWithWinner(
    db: PrismaDbClient,
    gameId: string,
    winnerCartelaId: string,
    finishedAt: Date,
  ): Promise<boolean> {
    const updateResult = await db.game.updateMany({
      where: {
        id: gameId,
        status: {
          in: [GameStatus.PLAYING, GameStatus.CHECKING],
        },
        winnerCartelaId: null,
      },
      data: {
        status: GameStatus.FINISHED,
        winnerCartelaId,
        finishedAt,
        playOrder: null,
      },
    });

    return updateResult.count === 1;
  }
}
