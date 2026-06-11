import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { GameOperationMode, GameStatus, Prisma } from '@prisma/client';
import { GameEngineService } from '../game-engine/game-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AutoCallService } from './auto-call.service';
import { GameQueueService } from './game-queue.service';
import {
  serializeGameSession,
  serializeGameSlot,
  toPlayerGameSession,
  toPlayerGameSlot,
} from './games.mapper';
import { gameSessionSelect, gameSlotSelect } from './games.select';
import { GameTimingConfigService } from '../game-timing-config/game-timing-config.service';

const TICK_MS = 1000;

@Injectable()
export class GameAutoStartSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(GameAutoStartSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gameEngineService: GameEngineService,
    private readonly autoCallService: AutoCallService,
    private readonly gameQueueService: GameQueueService,
    private readonly realtimeService: RealtimeService,
    private readonly gameTimingConfigService: GameTimingConfigService,
  ) {}

  onModuleInit() {
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
  }

  onModuleDestroy() {
    this.shuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    if (this.shuttingDown || this.ticking) {
      return;
    }

    this.ticking = true;

    try {
      const dueSessions = await this.prisma.gameSession.findMany({
        where: {
          status: GameStatus.READY,
          scheduledStartAt: { lte: new Date() },
        },
        select: {
          id: true,
          gameSlotId: true,
        },
        orderBy: { scheduledStartAt: 'asc' },
      });

      for (const dueSession of dueSessions) {
        await this.processDueSession(dueSession.id, dueSession.gameSlotId);
      }

      await this.openNextAutoQueueRegistration();
    } catch (error) {
      this.logger.error(
        'Auto-start scheduler tick failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.ticking = false;
    }
  }

  private async processDueSession(sessionId: string, slotId: string) {
    const claimResult = await this.prisma.gameSession.updateMany({
      where: {
        id: sessionId,
        status: GameStatus.READY,
        scheduledStartAt: { lte: new Date() },
      },
      data: { scheduledStartAt: null },
    });

    if (claimResult.count !== 1) {
      return;
    }

    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        gameSlotId: true,
        _count: {
          select: {
            gameCartelas: true,
          },
        },
        gameSlot: {
          select: {
            id: true,
            operationMode: true,
            autoCallIntervalSeconds: true,
          },
        },
      },
    });

    if (!session || session.gameSlot.operationMode !== GameOperationMode.AUTO) {
      return;
    }

    if (session._count.gameCartelas === 0) {
      await this.cancelEmptyReadySession(sessionId, slotId);
      return;
    }

    try {
      const startedSession = await this.gameEngineService.startGame(slotId);
      const intervalSeconds =
        await this.gameTimingConfigService.getAutoCallIntervalSeconds();

      await this.prisma.gameSession.update({
        where: { id: startedSession.id },
        data: {
          autoCallIntervalMs: intervalSeconds * 1000,
        },
      });

      await this.autoCallService.startAutoCall(startedSession.id);
    } catch (error) {
      this.logger.warn(
        `Auto-start failed for session ${sessionId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  private async openNextAutoQueueRegistration() {
    const createdSession = await this.prisma.$transaction(async (tx) => {
      const activeSession = await tx.gameSession.findFirst({
        where: {
          status: {
            in: [
              GameStatus.PLAYING,
              GameStatus.WINNER_WINDOW,
              GameStatus.CHECKING,
            ],
          },
        },
        select: { id: true },
      });

      if (activeSession) {
        return null;
      }

      const queueHead = await tx.gameSlot.findFirst({
        where: { status: GameStatus.NEXT },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          operationMode: true,
          entryFee: true,
          prizePerCartela: true,
          registrationDurationSeconds: true,
        },
      });

      if (!queueHead || queueHead.operationMode !== GameOperationMode.AUTO) {
        return null;
      }

      const existingReadySession = await tx.gameSession.findFirst({
        where: {
          gameSlotId: queueHead.id,
          status: GameStatus.READY,
        },
        select: { id: true },
      });

      if (existingReadySession) {
        return null;
      }

      const registrationDurationSeconds =
        await this.gameTimingConfigService.getRegistrationDurationSeconds();
      const autoCallIntervalSeconds =
        await this.gameTimingConfigService.getAutoCallIntervalSeconds();
      const scheduledStartAt = new Date(
        Date.now() + registrationDurationSeconds * 1000,
      );

      await tx.gameSlot.update({
        where: { id: queueHead.id },
        data: {
          registrationDurationSeconds,
          autoCallIntervalSeconds,
        },
      });
      const companyFeePerCartela = new Prisma.Decimal(
        queueHead.entryFee.toString(),
      ).minus(new Prisma.Decimal(queueHead.prizePerCartela.toString()));

      return tx.gameSession.create({
        data: {
          gameSlotId: queueHead.id,
          playCode: this.generatePlayCode(),
          entryFee: queueHead.entryFee,
          prizePerCartela: queueHead.prizePerCartela,
          companyFeePerCartela,
          prizeAmount: new Prisma.Decimal(0),
          companyRevenue: new Prisma.Decimal(0),
          status: GameStatus.READY,
          scheduledStartAt,
        },
        select: gameSessionSelect,
      });
    });

    if (!createdSession) {
      return;
    }

    this.emitRegistrationOpened(createdSession);
  }

  private emitRegistrationOpened(
    session: Prisma.GameSessionGetPayload<{ select: typeof gameSessionSelect }>,
  ) {
    const sessionPayload = serializeGameSession(session);
    const playerSessionPayload = toPlayerGameSession(sessionPayload);

    this.realtimeService.emitToSession(
      session.id,
      'game:status_changed',
      playerSessionPayload,
    );
    this.realtimeService.emitToAdmin('game:status_changed', sessionPayload);
    this.realtimeService.emitToPublicGames(
      'game:status_changed',
      playerSessionPayload,
    );
    this.realtimeService.emitGameOperationUpdate({
      slotId: session.gameSlotId,
      sessionId: session.id,
      adminPayload: sessionPayload,
      publicPayload: playerSessionPayload,
    });
  }

  private generatePlayCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `BINGO-${code}`;
  }

  private async cancelEmptyReadySession(sessionId: string, slotId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const cancelledSession = await tx.gameSession.update({
        where: { id: sessionId },
        data: { status: GameStatus.CANCELLED },
        select: gameSessionSelect,
      });

      await this.gameQueueService.moveSlotToBack(tx, slotId);

      const updatedSlot = await tx.gameSlot.findUnique({
        where: { id: slotId },
        select: gameSlotSelect,
      });

      return { cancelledSession, updatedSlot };
    });

    const sessionPayload = serializeGameSession(result.cancelledSession);
    const playerSessionPayload = toPlayerGameSession(sessionPayload);

    this.realtimeService.emitToSession(
      sessionId,
      'game:status_changed',
      playerSessionPayload,
    );
    this.realtimeService.emitToAdmin('game:status_changed', sessionPayload);
    this.realtimeService.emitToPublicGames(
      'game:status_changed',
      playerSessionPayload,
    );

    if (result.updatedSlot) {
      const slotPayload = serializeGameSlot(result.updatedSlot);
      const publicSlotPayload = toPlayerGameSlot(slotPayload);
      this.realtimeService.emitGameOperationUpdate({
        slotId,
        sessionId: null,
        adminPayload: slotPayload,
        publicPayload: publicSlotPayload,
      });
    }
  }
}
