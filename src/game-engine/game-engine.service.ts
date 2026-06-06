import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GameStatus, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/services/audit-log.service';
import { GameQueueService } from '../games/game-queue.service';
import { StartSessionDto } from '../games/dto/start-session.dto';
import {
  serializeGameSession,
  toPlayerGameSession,
} from '../games/games.mapper';
import { gameSessionSelect } from '../games/games.select';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

type PrismaDbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class GameEngineService {
  private static readonly defaultEntryFee = '10';
  private static readonly defaultPrizePerCartela = '8';
  private static readonly defaultCompanyFeePerCartela = '2';

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
    private readonly gameQueueService: GameQueueService,
  ) {}

  async startGame(
    slotId: string,
    actorId?: string,
    sessionConfig?: StartSessionDto,
  ) {
    const startedAt = new Date();

    // Check if this slot has a READY session (created by player registration).
    // If so, transition it to PLAYING. If it already has a PLAYING/CHECKING session,
    // emit events and return it.
    const existingPlayingSession = await this.prisma.gameSession.findFirst({
      where: {
        gameSlotId: slotId,
        status: { in: [GameStatus.PLAYING, GameStatus.CHECKING] },
      },
      select: gameSessionSelect,
    });

    if (existingPlayingSession) {
      const payload = serializeGameSession(existingPlayingSession);
      const playerPayload = toPlayerGameSession(payload);
      this.realtimeService.emitToSession(
        existingPlayingSession.id,
        'game:status_changed',
        playerPayload,
      );
      this.realtimeService.emitToAdmin('game:status_changed', payload);
      this.realtimeService.emitToPublicGames(
        'game:status_changed',
        playerPayload,
      );
      this.realtimeService.emitGameOperationUpdate({
        slotId,
        sessionId: existingPlayingSession.id,
        adminPayload: payload,
        publicPayload: playerPayload,
      });
      return payload;
    }

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

      // Check for READY session to transition to PLAYING
      const readySession = await tx.gameSession.findFirst({
        where: {
          gameSlotId: slotId,
          status: GameStatus.READY,
        },
        select: { id: true, entryFee: true, prizePerCartela: true, companyFeePerCartela: true },
      });

      await this.gameQueueService.assertSlotReady(tx, slotId);

      const slot = await tx.gameSlot.findUnique({
        where: { id: slotId },
        select: {
          gameType: true,
          name: true,
          entryFee: true,
          prizePerCartela: true,
        },
      });

      if (!slot) {
        throw new NotFoundException('Game slot not found');
      }

      // Update slot status to PLAYING
      await tx.gameSlot.update({
        where: { id: slotId },
        data: { status: GameStatus.PLAYING },
      });

      let session;

      if (readySession) {
        // Transition existing READY session to PLAYING
        session = await tx.gameSession.update({
          where: { id: readySession.id },
          data: {
            status: GameStatus.PLAYING,
            startedAt,
          },
          select: gameSessionSelect,
        });
      } else {
        // Create new GameSession (for slots without prior registrations)
        const feeConfig = this.resolveFeeConfig(sessionConfig, slot);
        const playCode = this.generateUniquePlayCode();
        session = await tx.gameSession.create({
          data: {
            gameSlotId: slotId,
            playCode,
            entryFee: feeConfig.entryFee,
            prizePerCartela: feeConfig.prizePerCartela,
            companyFeePerCartela: feeConfig.companyFeePerCartela,
            prizeAmount: new Prisma.Decimal(0),
            companyRevenue: new Prisma.Decimal(0),
            status: GameStatus.PLAYING,
            startedAt,
          },
          select: gameSessionSelect,
        });
      }

      if (actorId) {
        await this.auditLogService.create(tx, {
          actorId,
          action: 'admin.session.start',
          entity: 'GameSession',
          entityId: session.id,
          metadata: {
            slotId,
            playCode: session.playCode,
            startedAt: startedAt.toISOString(),
            entryFee: session.entryFee.toString(),
            prizePerCartela: session.prizePerCartela.toString(),
            companyFeePerCartela: session.companyFeePerCartela.toString(),
          },
        });
      }

      return session;
    });

    const payload = serializeGameSession(result);
    const playerPayload = toPlayerGameSession(payload);
    this.realtimeService.emitToSession(
      result.id,
      'game:status_changed',
      playerPayload,
    );
    this.realtimeService.emitToAdmin('game:status_changed', payload);
    this.realtimeService.emitToPublicGames('game:status_changed', playerPayload);

    this.realtimeService.emitGameOperationUpdate({
      slotId: result.gameSlotId,
      sessionId: result.id,
      adminPayload: payload,
      publicPayload: playerPayload,
    });

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
      // Move slot to back of queue and set status to NEXT
      await this.gameQueueService.moveSlotToBack(db, session.gameSlotId);
      await db.gameSlot.update({
        where: { id: session.gameSlotId },
        data: { status: GameStatus.NEXT },
      });

      return true;
    }

    return false;
  }

  private resolveFeeConfig(
    sessionConfig: StartSessionDto | undefined,
    slot: { entryFee: Prisma.Decimal; prizePerCartela: Prisma.Decimal },
  ) {
    const entryFee = this.parseMoney(
      sessionConfig?.entryFee ?? slot.entryFee.toString(),
      'entryFee',
      false,
    );
    const prizePerCartela = this.parseMoney(
      sessionConfig?.prizePerCartela ?? slot.prizePerCartela.toString(),
      'prizePerCartela',
      true,
    );
    const companyFeePerCartela = this.parseMoney(
      sessionConfig?.companyFeePerCartela ??
        entryFee.minus(prizePerCartela).toString(),
      'companyFeePerCartela',
      true,
    );

    if (!entryFee.equals(prizePerCartela.plus(companyFeePerCartela))) {
      throw new BadRequestException(
        'entryFee must equal prizePerCartela plus companyFeePerCartela',
      );
    }

    return {
      entryFee,
      prizePerCartela,
      companyFeePerCartela,
    };
  }

  private parseMoney(
    value: string,
    fieldName: string,
    allowZero: boolean,
  ): Prisma.Decimal {
    const amount = new Prisma.Decimal(value);

    if (allowZero ? amount.lt(0) : amount.lte(0)) {
      throw new BadRequestException(
        allowZero
          ? `${fieldName} must be zero or greater`
          : `${fieldName} must be greater than zero`,
      );
    }

    return amount;
  }

  private generateUniquePlayCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `BINGO-${code}`;
  }
}
