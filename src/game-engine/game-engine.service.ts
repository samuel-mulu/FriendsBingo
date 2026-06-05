import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GameStatus, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/services/audit-log.service';
import { GameQueueService } from '../games/game-queue.service';
import { serializeGameSession } from '../games/games.mapper';
import { gameSessionSelect } from '../games/games.select';
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

  async startGame(slotId: string, actorId?: string, entryFeeInput?: string) {
    const startedAt = new Date();
    const entryFee = (() => {
      const parsed = entryFeeInput != null ? Number(entryFeeInput) : 10;
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10;
    })();

    const result = await this.prisma.$transaction(async (tx) => {
      const activeSession = await tx.gameSession.findFirst({
        where: {
          status: {
            in: [GameStatus.PLAYING, GameStatus.CHECKING],
          },
        },
        select: { id: true },
      });

      if (activeSession) {
        throw new BadRequestException(
          'Another game session is already active. Finish or cancel it before starting a new one.',
        );
      }

      await this.gameQueueService.assertSlotReady(tx, slotId);

      const slot = await tx.gameSlot.findUnique({
        where: { id: slotId },
        select: { gameType: true, name: true },
      });

      if (!slot) {
        throw new NotFoundException('Game slot not found');
      }

      // Update slot status
      await tx.gameSlot.update({
        where: { id: slotId },
        data: { status: GameStatus.PLAYING },
      });

      // Create new GameSession
      const playCode = await this.generateUniquePlayCode();
      const session = await tx.gameSession.create({
        data: {
          gameSlotId: slotId,
          playCode,
          entryFee, // Default 10 or admin override
          prizeAmount: 0, // Will be updated as players register
          status: GameStatus.PLAYING,
          startedAt,
        },
        select: gameSessionSelect,
      });

      if (actorId) {
        await this.auditLogService.create(tx, {
          actorId,
          action: 'admin.session.start',
          entity: 'GameSession',
          entityId: session.id,
          metadata: {
            slotId,
            playCode,
            startedAt: startedAt.toISOString(),
          },
        });
      }

      return session;
    });

    const payload = serializeGameSession(result);
    this.realtimeService.emitToSession(result.id, 'game:status_changed', payload);
    this.realtimeService.emitToAdmin('game:status_changed', payload);
    this.realtimeService.emitToPublicGames('game:status_changed', payload);

    return payload;
  }

  async finishGameWithWinner(
    db: PrismaDbClient,
    sessionId: string,
    winnerCartelaId: string,
    finishedAt: Date,
  ): Promise<boolean> {
    const session = await db.gameSession.findUnique({
      where: { id: sessionId },
      select: { gameSlotId: true },
    });

    if (!session) return false;

    const updateResult = await db.gameSession.updateMany({
      where: {
        id: sessionId,
        status: {
          in: [GameStatus.PLAYING, GameStatus.CHECKING],
        },
        winnerCartelaId: null,
      },
      data: {
        status: GameStatus.FINISHED,
        winnerCartelaId,
        finishedAt,
      },
    });

    if (updateResult.count === 1) {
      await this.gameQueueService.moveSlotToBack(db as any, session.gameSlotId);
      return true;
    }

    return false;
  }

  private async generateUniquePlayCode(): Promise<string> {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `BINGO-${code}`;
  }
}
