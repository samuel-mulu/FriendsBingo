import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  BingoClaimStatus,
  GameCartelaStatus,
  GameCategory,
  GameOperationMode,
  GameStatus,
  Prisma,
} from '@prisma/client';
import { AuditLogService } from '../common/services/audit-log.service';
import { GameQueueService } from '../games/game-queue.service';
import { OperationsCacheService } from '../games/operations-cache.service';
import {
  OpenedRegistrationTransition,
  PostGameRegistrationOpenerService,
} from '../games/post-game-registration-opener.service';
import { StartSessionDto } from '../games/dto/start-session.dto';
import { GameTimingConfigService } from '../game-timing-config/game-timing-config.service';
import { DEFAULT_NO_WINNER_GRACE_SECONDS } from '../game-timing-config/game-timing-config.defaults';
import {
  serializeGameSession,
  serializeGameSlot,
  serializeWinnerPayoutsSummary,
  toPlayerGameSession,
  toPlayerGameSlot,
  withTerminalSessionContextForAdminSlot,
  withTerminalSessionContextForPlayerSlot,
} from '../games/games.mapper';
import { GameRuleEvaluationService } from '../game-rules/game-rule-evaluation.service';
import {
  buildSessionMoneyConfig,
  isBonusCategory,
  isStandardQueueCategory,
} from '../games/game-category.util';
import { GamePushNotificationsService } from '../notifications/game-push-notifications.service';
import { NotificationsService } from '../notifications/notifications.service';
import { pushNotificationMessages } from '../notifications/push-notification-messages';
import { buildSessionWinnerResults } from '../games/session-winner-results.builder';
import { gameSessionSelect, gameSlotSelect } from '../games/games.select';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { GameLifecycleDebugLogger } from '../games/game-lifecycle-debug-logger.service';
import { GameOperationInvariantsService } from '../games/game-operation-invariants.service';

@Injectable()
export class GameEngineService {
  private static readonly defaultEntryFee = '10';
  private static readonly defaultPrizePerCartela = '8';
  private static readonly defaultCompanyFeePerCartela = '2';
  private readonly logger = new Logger(GameEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
    private readonly gameQueueService: GameQueueService,
    private readonly operationsCacheService: OperationsCacheService,
    private readonly gameRuleEvaluationService: GameRuleEvaluationService,
    @Inject(forwardRef(() => PostGameRegistrationOpenerService))
    private readonly postGameRegistrationOpenerService: PostGameRegistrationOpenerService,
    @Optional()
    private readonly gameTimingConfigService: GameTimingConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly gamePushNotificationsService: GamePushNotificationsService,
    private readonly lifecycleLogger: GameLifecycleDebugLogger,
    private readonly invariantsService: GameOperationInvariantsService,
  ) {}

  async startGame(
    slotId: string,
    actorId?: string,
    sessionConfig?: StartSessionDto,
  ) {
    const startedAt = new Date();
    this.logger.log(
      `[game_transition_start] gameId=${slotId} previousStatus=READY nextStatus=PLAYING`,
    );

    // Check if this slot has a READY session (created by player registration).
    // If so, transition it to PLAYING. If it already has a PLAYING/CHECKING session,
    // emit events and return it.
    const existingPlayingSession = await this.prisma.gameSession.findFirst({
      where: {
        gameSlotId: slotId,
        status: {
          in: [
            GameStatus.PLAYING,
            GameStatus.WINNER_WINDOW,
            GameStatus.CHECKING,
          ],
        },
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
          category: true,
          fixedPrizeAmount: true,
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

        this.lifecycleLogger?.sessionStatusChanged?.({
          sessionId: readySession.id,
          slotId,
          fromStatus: GameStatus.READY,
          toStatus: GameStatus.PLAYING,
          reason: actorId ? 'admin_start' : 'auto_start',
        });

        this.lifecycleLogger?.slotStatusChanged?.({
          slotId,
          fromStatus: GameStatus.NEXT,
          toStatus: GameStatus.PLAYING,
          reason: 'session_started',
          sessionId: readySession.id,
        });
      } else {
        // Create new GameSession (for slots without prior registrations)
        const feeConfig = isBonusCategory(slot.category)
          ? buildSessionMoneyConfig(slot)
          : this.resolveFeeConfig(sessionConfig, slot);
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

        this.lifecycleLogger?.sessionCreated?.({
          sessionId: session.id,
          slotId,
          slotStatus: GameStatus.PLAYING,
          sessionStatus: GameStatus.PLAYING,
          category: slot.category,
          operationMode: session.gameSlot.operationMode,
          reason: 'admin_start_manual',
        });

        this.lifecycleLogger?.slotStatusChanged?.({
          slotId,
          fromStatus: GameStatus.NEXT,
          toStatus: GameStatus.PLAYING,
          reason: 'session_started',
          sessionId: session.id,
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

      const openedRegistration =
        readySession &&
        session.gameSlot.operationMode === GameOperationMode.AUTO &&
        isStandardQueueCategory(slot.category)
          ? await this.postGameRegistrationOpenerService.openNextAutoQueueRegistrationInTransaction(
              tx,
              {
                allowBehindActiveLive: true,
                countdownMode: 'deferred',
              },
            )
          : null;

      return {
        session,
        hadReadySession: !!readySession,
        slot,
        openedRegistration,
      };
    });

    this.lifecycleLogger?.gameStarted?.({
      sessionId: result.session.id,
      slotId,
      category: result.slot.category,
      operationMode: result.session.gameSlot.operationMode,
      reason: actorId ? 'admin_manual' : 'scheduler_auto',
      hadReadySession: result.hadReadySession,
    });

    let openedNextRegistration = false;
    try {
      openedNextRegistration =
        await this.postGameRegistrationOpenerService.finalizeOpenedRegistration(
          result.openedRegistration,
        );
    } catch (error) {
      this.logger.warn(
        `Deferred READY finalize failed after PLAYING commit for slot ${slotId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }

    // Clear cached operations before realtime emits so any immediate
    // GET /games/operations/current triggered by the socket sees PLAYING.
    this.operationsCacheService.invalidate();

    const payload = serializeGameSession(result.session);
    const playerPayload = toPlayerGameSession(payload);
    this.realtimeService.emitToSession(
      result.session.id,
      'game:status_changed',
      playerPayload,
    );
    this.realtimeService.emitToAdmin('game:status_changed', payload);
    this.realtimeService.emitToPublicGames('game:status_changed', playerPayload);

    this.realtimeService.emitGameOperationUpdate({
      slotId: result.session.gameSlotId,
      sessionId: result.session.id,
      adminPayload: payload,
      publicPayload: playerPayload,
    });
    await this.notifyGameStarted(result.session);
    this.logger.log(
      `[game_transition_end] gameId=${result.session.id} previousStatus=READY nextStatus=PLAYING committed=true openedNextRegistration=${openedNextRegistration} emittedEvent=game:operation_updated`,
    );

    // Check invariants after game start
    void this.invariantsService?.assertGameOperationInvariants?.();

    return payload;
  }

  async finishGameWithWinner(
    db: Prisma.TransactionClient,
    sessionId: string,
    winnerCartelaId: string,
    finishedAt: Date,
  ): Promise<{
    finished: boolean;
    openedRegistration: OpenedRegistrationTransition | null;
  }> {
    const session = await db.gameSession.findUnique({
      where: { id: sessionId },
      select: { gameSlotId: true },
    });

    if (!session) {
      return { finished: false, openedRegistration: null };
    }

    const updateResult = await db.gameSession.updateMany({
      where: {
        id: sessionId,
        status: {
          in: [
            GameStatus.PLAYING,
            GameStatus.WINNER_WINDOW,
            GameStatus.CHECKING,
          ],
        },
        winnerCartelaId: null,
      },
      data: {
        status: GameStatus.FINISHED,
        winnerCartelaId,
        finishedAt,
        noWinnerGraceEndsAt: null,
        noWinnerReason: null,
      },
    });

    if (updateResult.count === 1) {
      await this.gameQueueService.restoreSlotAfterSession(
        db,
        session.gameSlotId,
      );

      const openedRegistration =
        await this.postGameRegistrationOpenerService.openNextAutoQueueRegistrationInTransaction(
          db,
          {
            ignoreReviewGrace: true,
          },
        );

      // Realtime events are emitted by the caller via emitSessionFinished()
      // AFTER the surrounding transaction commits, so payloads reflect
      // committed data.
      return { finished: true, openedRegistration };
    }

    return { finished: false, openedRegistration: null };
  }

  async startNoWinnerGrace(
    sessionId: string,
  ): Promise<{ started: boolean; noWinnerGraceEndsAt: Date | null }> {
    const graceSeconds =
      this.gameTimingConfigService?.getNoWinnerGraceSeconds() ??
      DEFAULT_NO_WINNER_GRACE_SECONDS;
    const noWinnerGraceEndsAt = new Date(Date.now() + graceSeconds * 1000);

    const updateResult = await this.prisma.gameSession.updateMany({
      where: {
        id: sessionId,
        status: GameStatus.PLAYING,
        winnerCartelaId: null,
        noWinnerGraceEndsAt: null,
      },
      data: {
        autoCallEnabled: false,
        nextAutoCallAt: null,
        noWinnerGraceEndsAt,
        noWinnerReason: 'ALL_NUMBERS_CALLED',
      },
    });

    if (updateResult.count === 1) {
      await this.auditLogService.create(this.prisma, {
        actorId: null,
        action: 'system.no_winner.grace_started',
        entity: 'GameSession',
        entityId: sessionId,
        metadata: {
          noWinnerGraceEndsAt: noWinnerGraceEndsAt.toISOString(),
          noWinnerReason: 'ALL_NUMBERS_CALLED',
          graceSeconds,
        },
      });
      return { started: true, noWinnerGraceEndsAt };
    }

    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { noWinnerGraceEndsAt: true },
    });

    return {
      started: false,
      noWinnerGraceEndsAt: session?.noWinnerGraceEndsAt ?? null,
    };
  }

  async finalizeExpiredNoWinnerSessions(): Promise<number> {
    const sessions = await this.prisma.gameSession.findMany({
      where: {
        status: {
          in: [GameStatus.PLAYING, GameStatus.CHECKING],
        },
        winnerCartelaId: null,
        noWinnerGraceEndsAt: {
          lte: new Date(),
        },
      },
      select: {
        id: true,
      },
    });

    let finalizedCount = 0;
    for (const session of sessions) {
      const finalized = await this.finalizeNoWinner(session.id);
      if (finalized) {
        finalizedCount += 1;
      }
    }

    return finalizedCount;
  }

  async finalizeNoWinner(sessionId: string): Promise<boolean> {
    const finalized = await this.prisma.$transaction(async (tx) => {
      const session = await tx.gameSession.findUnique({
        where: { id: sessionId },
        select: { gameSlotId: true },
      });

      if (!session) {
        return false;
      }

      const finishedAt = new Date();
      const updateResult = await tx.gameSession.updateMany({
        where: {
          id: sessionId,
          status: {
            in: [GameStatus.PLAYING, GameStatus.CHECKING],
          },
          winnerCartelaId: null,
          noWinnerGraceEndsAt: {
            lte: finishedAt,
          },
        },
        data: {
          status: GameStatus.NO_WINNER,
          finishedAt,
          autoCallEnabled: false,
          nextAutoCallAt: null,
        },
      });

      if (updateResult.count !== 1) {
        return false;
      }

      await tx.gameCartela.updateMany({
        where: {
          gameSessionId: sessionId,
          status: GameCartelaStatus.REGISTERED,
          isWinner: false,
        },
        data: {
          status: GameCartelaStatus.BLOCKED,
          blockedAt: finishedAt,
        },
      });

      await tx.bingoClaim.updateMany({
        where: {
          gameSessionId: sessionId,
          status: BingoClaimStatus.PENDING,
        },
        data: {
          status: BingoClaimStatus.INVALID,
          reason: 'Game ended with no winner after all numbers were called',
          checkedAt: finishedAt,
        },
      });

      await this.gameQueueService.restoreSlotAfterSession(
        tx,
        session.gameSlotId,
      );

      await this.auditLogService.create(tx, {
        actorId: null,
        action: 'system.no_winner.finalized',
        entity: 'GameSession',
        entityId: sessionId,
        metadata: {
          finishedAt: finishedAt.toISOString(),
          noWinnerReason: 'ALL_NUMBERS_CALLED',
        },
      });

      const openedRegistration =
        await this.postGameRegistrationOpenerService.openNextAutoQueueRegistrationInTransaction(
          tx,
          {
            ignoreReviewGrace: true,
          },
        );

      return { finalized: true, openedRegistration };
    });

    if (finalized) {
      await this.postGameRegistrationOpenerService.finalizeOpenedRegistration(
        finalized.openedRegistration,
      );
      await this.emitSessionFinished(sessionId, {
        openedNextRegistration: finalized.openedRegistration != null,
      });
      return true;
    }

    return false;
  }

  async emitSessionUpdated(sessionId: string): Promise<void> {
    const updatedSession = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: gameSessionSelect,
    });

    if (!updatedSession) {
      return;
    }

    this.operationsCacheService.invalidate();

    const sessionPayload = serializeGameSession(updatedSession);
    const playerPayload = toPlayerGameSession(sessionPayload);

    this.realtimeService.emitToSession(
      updatedSession.id,
      'game:status_changed',
      playerPayload,
    );
    this.realtimeService.emitToAdmin('game:status_changed', sessionPayload);
    this.realtimeService.emitToPublicGames(
      'game:status_changed',
      playerPayload,
    );

    this.realtimeService.emitGameOperationUpdate({
      slotId: updatedSession.gameSlotId,
      sessionId: updatedSession.id,
      adminPayload: sessionPayload,
      publicPayload: playerPayload,
    });
  }

  /**
   * Single finish emitter shared by every terminal-finish path (manual claim
   * approval, winner window finalization). Fetches committed session/slot
   * state, invalidates the operations cache and emits game:status_changed,
   * game:finished and game:operation_updated.
   */
  async emitSessionFinished(
    sessionId: string,
    options?: { openedNextRegistration?: boolean },
  ): Promise<void> {
    const updatedSession = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: gameSessionSelect,
    });

    if (!updatedSession) return;

    this.logger.log(
      `[game_transition_start] gameId=${sessionId} previousStatus=${updatedSession.status} nextStatus=READY`,
    );

    this.operationsCacheService.invalidate();

    const sessionPayload = serializeGameSession(updatedSession);
    const playerPayload = toPlayerGameSession(sessionPayload);
    const winningCartelas = (updatedSession.gameCartelas ?? []).filter(
      (cartela) => cartela.isWinner,
    );
    const winnerPayoutsSummary = serializeWinnerPayoutsSummary(
      winningCartelas,
      updatedSession.prizeAmount,
    );
    const winnerResults = await buildSessionWinnerResults(
      this.prisma,
      sessionId,
      this.gameRuleEvaluationService,
    );
    const terminalSessionContext = {
      ...sessionPayload,
      winnerPayoutsSummary,
      winnerResults,
    };

    this.realtimeService.emitToSession(
      updatedSession.id,
      'game:status_changed',
      playerPayload,
    );
    this.realtimeService.emitToAdmin('game:status_changed', sessionPayload);
    this.realtimeService.emitToPublicGames(
      'game:status_changed',
      playerPayload,
    );

    const updatedSlot = await this.prisma.gameSlot.findUnique({
      where: { id: updatedSession.gameSlotId },
      select: gameSlotSelect,
    });

    if (!updatedSlot) return;

    const adminSlotPayload = withTerminalSessionContextForAdminSlot(
      serializeGameSlot(updatedSlot),
      terminalSessionContext,
    );
    const publicSlotPayload = withTerminalSessionContextForPlayerSlot(
      toPlayerGameSlot(adminSlotPayload),
      terminalSessionContext,
    );

    this.realtimeService.emitGameFinished({
      sessionId: updatedSession.id,
      adminPayload: adminSlotPayload,
      publicPayload: publicSlotPayload,
    });

    this.realtimeService.emitGameOperationUpdate({
      slotId: updatedSession.gameSlotId,
      sessionId: updatedSession.id,
      adminPayload: adminSlotPayload,
      publicPayload: publicSlotPayload,
    });

    this.logger.log(
      `[game_transition_end] gameId=${updatedSession.id} previousStatus=${updatedSession.status} nextStatus=READY committed=true openedNextRegistration=${options?.openedNextRegistration ?? false} emittedEvent=game:operation_updated`,
    );

    await this.notifySessionFinished(updatedSession);
  }

  private resolveFeeConfig(
    sessionConfig: StartSessionDto | undefined,
    slot: {
      entryFee: Prisma.Decimal;
      prizePerCartela: Prisma.Decimal;
      category?: GameCategory | null;
    },
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

  private async notifyGameStarted(
    session: Prisma.GameSessionGetPayload<{ select: typeof gameSessionSelect }>,
  ) {
    const userIds = this.extractSessionUserIds(session);
    if (userIds.length === 0) {
      return;
    }

    try {
      await this.gamePushNotificationsService.notifyGameStarted(
        session,
        userIds,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to send GAME_STARTED push for session ${session.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async notifySessionFinished(
    session: Prisma.GameSessionGetPayload<{ select: typeof gameSessionSelect }>,
  ) {
    const participantUserIds = this.extractSessionUserIds(session);
    const gameName = this.getNotificationGameName(session);
    const gameLabel = this.getNotificationGameLabel(session);
    const winnerUserIds = [
      ...new Set(
        (session.gameCartelas ?? [])
          .filter((cartela) => cartela.isWinner)
          .map((cartela) => cartela.userId),
      ),
    ];
    const winnerUserIdSet = new Set(winnerUserIds);
    const nonWinnerParticipantUserIds = participantUserIds.filter(
      (userId) => !winnerUserIdSet.has(userId),
    );

    const notificationTasks: Promise<{
      userCount: number;
      sentCount: number;
      failedCount: number;
    }>[] = [];

    if (nonWinnerParticipantUserIds.length > 0) {
      notificationTasks.push(
        this.notificationsService.sendAppNotificationToUsers(
          nonWinnerParticipantUserIds,
          {
            category: 'GAME_FINISHED',
            title: pushNotificationMessages.gameFinished.title(gameName),
            body: pushNotificationMessages.gameFinished.body(gameLabel),
            route: '/games',
            entityId: session.id,
            data: {
              sessionId: session.id,
              slotId: session.gameSlotId,
              playCode: session.playCode,
            },
          },
        ),
      );
    }

    if (winnerUserIds.length > 0) {
      notificationTasks.push(
        this.notificationsService.sendAppNotificationToUsers(winnerUserIds, {
          category: 'WINNER_ANNOUNCEMENT',
          title: pushNotificationMessages.winnerAnnouncement.title,
          body: pushNotificationMessages.winnerAnnouncement.body(
            session.prizeAmount.toString(),
            gameName,
            session.playCode,
          ),
          route: '/games',
          entityId: session.id,
          data: {
            sessionId: session.id,
            slotId: session.gameSlotId,
            playCode: session.playCode,
            prizeAmount: session.prizeAmount.toString(),
          },
        }),
      );
    }

    if (notificationTasks.length === 0) {
      return;
    }

    const results = await Promise.allSettled(notificationTasks);
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Failed to send session-finished push for session ${session.id}: ${
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
          }`,
        );
        continue;
      }

      this.logger.log(
        `Session-finished push summary sessionId=${session.id} sent=${result.value.sentCount} failed=${result.value.failedCount}`,
      );
    }
  }

  private extractSessionUserIds(
    session: Prisma.GameSessionGetPayload<{ select: typeof gameSessionSelect }>,
  ) {
    return [
      ...new Set((session.gameCartelas ?? []).map((cartela) => cartela.userId)),
    ];
  }

  private getNotificationGameName(
    session: Prisma.GameSessionGetPayload<{ select: typeof gameSessionSelect }>,
  ) {
    return session.gameSlot.name?.trim() || pushNotificationMessages.defaultGameName;
  }

  private getNotificationGameLabel(
    session: Prisma.GameSessionGetPayload<{ select: typeof gameSessionSelect }>,
  ) {
    const gameName = this.getNotificationGameName(session);
    return session.playCode ? `${gameName} (${session.playCode})` : gameName;
  }
}
