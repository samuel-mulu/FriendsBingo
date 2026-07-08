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
import { serializeGameSession, toPlayerGameSession } from './games.mapper';
import {
  buildSessionMoneyConfig,
  compareCategoryPriority,
  compareSortOrder,
  isStandardQueueCategory,
} from './game-category.util';
import { gameSessionSelect } from './games.select';
import { OperationsCacheService } from './operations-cache.service';
import { GameLifecycleDebugLogger } from './game-lifecycle-debug-logger.service';
import { GameOperationInvariantsService } from './game-operation-invariants.service';
import { tryAcquireGameTransitionLock } from './game-transition-lock';

export type OpenNextRegistrationOptions = {
  ignoreReviewGrace?: boolean;
  allowBehindActiveLive?: boolean;
  countdownMode?: 'deferred';
};

export type OpenedRegistrationTransition = {
  session: Prisma.GameSessionGetPayload<{ select: typeof gameSessionSelect }>;
  slotId: string;
  category: GameCategory;
  operationMode: GameOperationMode;
  scheduledStartAt: Date | null;
  emitReason:
    | 'scheduler_tick'
    | 'deferred_behind_live'
    | 'existing_ready_activated';
  wasCreated: boolean;
  slotStatus: GameStatus;
};

@Injectable()
export class PostGameRegistrationOpenerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameTimingConfigService: GameTimingConfigService,
    private readonly operationsCacheService: OperationsCacheService,
    private readonly realtimeService: RealtimeService,
    private readonly gamePushNotificationsService: GamePushNotificationsService,
    private readonly lifecycleLogger: GameLifecycleDebugLogger,
    private readonly invariantsService: GameOperationInvariantsService,
  ) {}

  async openNextAutoQueueRegistration(
    options: OpenNextRegistrationOptions = {},
  ): Promise<boolean> {
    const openedRegistration = await this.prisma.$transaction(
      (tx) => this.openNextAutoQueueRegistrationInTransaction(tx, options),
      {
        timeout: 20_000,
        maxWait: 20_000,
      },
    );

    if (!openedRegistration) {
      return false;
    }

    await this.finalizeOpenedRegistration(openedRegistration);
    return openedRegistration != null;
  }

  async openNextAutoQueueRegistrationInTransaction(
    tx: Prisma.TransactionClient,
    options: OpenNextRegistrationOptions = {},
  ): Promise<OpenedRegistrationTransition | null> {
    const hasTransitionLock = await tryAcquireGameTransitionLock(tx);
    if (!hasTransitionLock) {
      return null;
    }

    const deferredRequested =
      options.allowBehindActiveLive && options.countdownMode === 'deferred';

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

    if (activeSession && !deferredRequested) {
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
          status: {
            in: [GameStatus.FINISHED, GameStatus.NO_WINNER],
          },
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

    const registrationDurationSeconds =
      await this.gameTimingConfigService.getRegistrationDurationSeconds();
    const autoCallIntervalSeconds =
      await this.gameTimingConfigService.getAutoCallIntervalSeconds();
    const scheduledStartAt =
      activeSession == null
        ? new Date(Date.now() + registrationDurationSeconds * 1000)
        : null;

    const existingStandardReadySession = await tx.gameSession.findFirst({
      where: {
        status: GameStatus.READY,
        gameSlot: {
          status: { not: GameStatus.CANCELLED },
        },
      },
      select: gameSessionSelect,
    });

    if (
      existingStandardReadySession &&
      isStandardQueueCategory(existingStandardReadySession.gameSlot.category)
    ) {
      if (
        activeSession == null &&
        existingStandardReadySession.scheduledStartAt == null &&
        existingStandardReadySession.gameSlot.operationMode ===
          GameOperationMode.AUTO
      ) {
        await tx.gameSlot.update({
          where: { id: existingStandardReadySession.gameSlotId },
          data: {
            registrationDurationSeconds,
            autoCallIntervalSeconds,
          },
        });
        const activatedSession = await tx.gameSession.update({
          where: { id: existingStandardReadySession.id },
          data: { scheduledStartAt },
          select: gameSessionSelect,
        });

        return {
          session: activatedSession,
          slotId: activatedSession.gameSlotId,
          category: activatedSession.gameSlot.category,
          operationMode: activatedSession.gameSlot.operationMode,
          scheduledStartAt,
          emitReason: 'existing_ready_activated',
          wasCreated: false,
          slotStatus: activatedSession.gameSlot.status,
        };
      }

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

    this.lifecycleLogger?.queueHeadSelected?.({
      slotId: queueHead.id,
      category: queueHead.category,
      sortOrder: queueHead.sortOrder ?? 0,
      operationMode: queueHead.operationMode,
      reason: 'registration_open',
    });

    const slotValidation = await this.isSlotValidForReadySession(tx, queueHead.id);
    if (!slotValidation.valid) {
      this.lifecycleLogger.invalidSessionCreationBlocked({
        slotId: queueHead.id,
        reason: slotValidation.reason!,
        attemptedStatus: GameStatus.READY,
      });
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

    await tx.gameSlot.update({
      where: { id: queueHead.id },
      data: {
        registrationDurationSeconds,
        autoCallIntervalSeconds,
      },
    });
    const sessionMoneyConfig = buildSessionMoneyConfig(queueHead);

    const newSession = await tx.gameSession.create({
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

    return {
      session: newSession,
      slotId: queueHead.id,
      category: queueHead.category,
      operationMode: queueHead.operationMode,
      scheduledStartAt,
      emitReason:
        activeSession != null && deferredRequested
          ? 'deferred_behind_live'
          : 'scheduler_tick',
      wasCreated: true,
      slotStatus: GameStatus.NEXT,
    };
  }

  async finalizeOpenedRegistration(
    openedRegistration: OpenedRegistrationTransition | null,
  ): Promise<boolean> {
    if (!openedRegistration) {
      return false;
    }

    if (openedRegistration.wasCreated) {
      this.lifecycleLogger?.sessionCreated?.({
        sessionId: openedRegistration.session.id,
        slotId: openedRegistration.slotId,
        slotStatus: openedRegistration.slotStatus,
        sessionStatus: GameStatus.READY,
        category: openedRegistration.category,
        operationMode: openedRegistration.operationMode,
        reason: 'post_game_opener',
        scheduledStartAt: openedRegistration.scheduledStartAt,
      });
    }

    this.lifecycleLogger?.registrationOpened?.({
      sessionId: openedRegistration.session.id,
      slotId: openedRegistration.slotId,
      category: openedRegistration.category,
      operationMode: openedRegistration.operationMode,
      scheduledStartAt: openedRegistration.scheduledStartAt,
      reason: openedRegistration.emitReason,
    });

    this.operationsCacheService.invalidate();
    this.emitRegistrationOpened(openedRegistration.session);
    void this.gamePushNotificationsService?.notifyRegistrationOpened?.(
      openedRegistration.session,
    );

    // Check invariants after session creation
    void this.invariantsService?.assertGameOperationInvariants?.();

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

  private async isSlotValidForReadySession(
    tx: Prisma.TransactionClient,
    slotId: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    const slot = await tx.gameSlot.findUnique({
      where: { id: slotId },
      select: { id: true, status: true },
    });

    if (!slot) {
      return { valid: false, reason: 'slot_not_found' };
    }

    if (slot.status === GameStatus.CANCELLED) {
      return { valid: false, reason: 'slot_cancelled' };
    }

    if (
      slot.status !== GameStatus.NEXT &&
      slot.status !== GameStatus.READY
    ) {
      return {
        valid: false,
        reason: `slot_in_invalid_state_${slot.status}`,
      };
    }

    return { valid: true };
  }
}
