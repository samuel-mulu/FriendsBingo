import { Injectable } from '@nestjs/common';
import {
  GameCategory,
  GameOperationMode,
  GameStatus,
  Prisma,
} from '@prisma/client';
import { GameTimingConfigService } from '../game-timing-config/game-timing-config.service';
import { GamePushNotificationsService } from '../notifications/game-push-notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AutoReadyCountdownRepairService } from './auto-ready-countdown-repair.service';
import { serializeGameSession, toPlayerGameSession } from './games.mapper';
import {
  buildSessionMoneyConfig,
  compareCategoryPriority,
  compareSortOrder,
} from './game-category.util';
import { gameSessionSelect } from './games.select';
import { OperationsCacheService } from './operations-cache.service';

export type OpenNextRegistrationOptions = {
  ignoreReviewGrace?: boolean;
};

@Injectable()
export class PostGameRegistrationOpenerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameTimingConfigService: GameTimingConfigService,
    private readonly operationsCacheService: OperationsCacheService,
    private readonly autoReadyCountdownRepairService: AutoReadyCountdownRepairService,
    private readonly realtimeService: RealtimeService,
    private readonly gamePushNotificationsService: GamePushNotificationsService,
  ) {}

  async openNextAutoQueueRegistration(
    options: OpenNextRegistrationOptions = {},
  ): Promise<boolean> {
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

      if (!options.ignoreReviewGrace) {
        // Client-only finished-review hold; scheduler ticks may still defer
        // opening until finishedResultDisplaySeconds after FINISHED.
        const finishedResultDisplaySeconds =
          await this.gameTimingConfigService.getFinishedResultDisplaySeconds();
        const graceCutoff = new Date(
          Date.now() - finishedResultDisplaySeconds * 1000,
        );

        const recentFinished = await tx.gameSession.findFirst({
          where: {
            status: GameStatus.FINISHED,
            updatedAt: { gte: graceCutoff },
          },
          select: { id: true },
        });

        if (recentFinished) {
          return null;
        }
      }

      const dueBigGame = await tx.gameSession.findFirst({
        where: {
          status: GameStatus.READY,
          scheduledStartAt: { lte: new Date() },
          gameSlot: {
            category: GameCategory.BIG_GAME,
            status: { not: GameStatus.CANCELLED },
          },
        },
        select: { id: true },
      });

      if (dueBigGame) {
        return null;
      }

      const queueSlots = await tx.gameSlot.findMany({
        where: { status: GameStatus.NEXT },
        select: {
          id: true,
          sortOrder: true,
          category: true,
          fixedPrizeAmount: true,
          operationMode: true,
          entryFee: true,
          prizePerCartela: true,
          registrationDurationSeconds: true,
        },
      });
      const queueHead = [...queueSlots].sort((left, right) => {
        const categoryDiff = compareCategoryPriority(
          left.category,
          right.category,
        );
        if (categoryDiff !== 0) {
          return categoryDiff;
        }

        return compareSortOrder(left.sortOrder, right.sortOrder);
      })[0];

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
      const sessionMoneyConfig = buildSessionMoneyConfig(queueHead);

      return tx.gameSession.create({
        data: {
          gameSlotId: queueHead.id,
          playCode: this.generatePlayCode(),
          entryFee: sessionMoneyConfig.entryFee,
          prizePerCartela: sessionMoneyConfig.prizePerCartela,
          companyFeePerCartela: sessionMoneyConfig.companyFeePerCartela,
          prizeAmount: sessionMoneyConfig.prizeAmount,
          companyRevenue: sessionMoneyConfig.companyRevenue,
          status: GameStatus.READY,
          scheduledStartAt,
        },
        select: gameSessionSelect,
      });
    });

    if (!createdSession) {
      return false;
    }

    this.operationsCacheService.invalidate();
    await this.autoReadyCountdownRepairService.ensureAutoReadySessionHasCountdown(
      createdSession.id,
    );
    this.emitRegistrationOpened(createdSession);
    void this.gamePushNotificationsService.notifyRegistrationOpened(
      createdSession,
    );
    return true;
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
}
