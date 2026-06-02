import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GameStatus, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/services/audit-log.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PrismaService } from '../prisma/prisma.service';
import { gameSummarySelect } from '../games/games.select';
import { serializeGame } from '../games/games.mapper';

type PrismaDbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class GameEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
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

      if (existingGame.status !== GameStatus.CHECKING) {
        throw new BadRequestException('Only CHECKING games can be started');
      }

      const updateResult = await tx.game.updateMany({
        where: {
          id: gameId,
          status: GameStatus.CHECKING,
        },
        data: {
          status: GameStatus.PLAYING,
          startedAt,
        },
      });

      if (updateResult.count !== 1) {
        throw new BadRequestException('Game could not be started');
      }

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
        status: GameStatus.PLAYING,
        winnerCartelaId: null,
      },
      data: {
        status: GameStatus.FINISHED,
        winnerCartelaId,
        finishedAt,
      },
    });

    return updateResult.count === 1;
  }
}
