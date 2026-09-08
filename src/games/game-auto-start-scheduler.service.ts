import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { GameOperationMode, GameStatus } from '@prisma/client';
import { GameEngineService } from '../game-engine/game-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { AutoCallService } from './auto-call.service';
import {
  compareSortOrder,
  getRuntimeQueuePriority,
  isBigGameCategory,
  isStandardQueueCategory,
} from './game-category.util';
import { GameLifecycleService } from './game-lifecycle.service';
import { GameTimingConfigService } from '../game-timing-config/game-timing-config.service';
import { AutoReadyCountdownRepairService } from './auto-ready-countdown-repair.service';
import { BigGameRoundService } from './big-game-round.service';
import { PostGameRegistrationOpenerService } from './post-game-registration-opener.service';

const TICK_MS = 2000;

@Injectable()
export class GameAutoStartSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(GameAutoStartSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private shuttingDown = false;
  private lastOpenNextAtMs = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gameEngineService: GameEngineService,
    private readonly autoCallService: AutoCallService,
    private readonly gameLifecycleService: GameLifecycleService,
    private readonly gameTimingConfigService: GameTimingConfigService,
    private readonly autoReadyCountdownRepairService: AutoReadyCountdownRepairService,
    private readonly postGameRegistrationOpenerService: PostGameRegistrationOpenerService,
    private readonly bigGameRoundService: BigGameRoundService,
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
      await this.autoReadyCountdownRepairService.repairAllMissingAutoReadyCountdowns();
      const now = new Date();

      const dueNextRoundSlotIds =
        await this.bigGameRoundService.findDueNextRoundSlotIds(now);
      for (const slotId of dueNextRoundSlotIds) {
        try {
          await this.bigGameRoundService.startNextBigGameRound(slotId);
        } catch (error) {
          this.logger.warn(
            `Failed to start next Big Game round for slot ${slotId}: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        }
      }

      // Big Game with a null play-start is intentional open-ended next-round
      // registration while the previous round is still live — do not treat as due.
      const dueSessions = await this.prisma.gameSession.findMany({
        where: {
          status: GameStatus.READY,
          scheduledStartAt: { lte: now },
        },
        select: {
          id: true,
          gameSlotId: true,
          scheduledStartAt: true,
          roundIndex: true,
          gameSlot: {
            select: {
              category: true,
              sortOrder: true,
            },
          },
        },
      });

      const standardReadyHeadSortOrder =
        await this.findStandardReadyHeadSortOrder();

      const prioritizedDueSessions = [...dueSessions]
        .filter((session) => {
          if (!isStandardQueueCategory(session.gameSlot.category)) {
            return true;
          }
          if (standardReadyHeadSortOrder == null) {
            return true;
          }
          return (
            compareSortOrder(
              session.gameSlot.sortOrder,
              standardReadyHeadSortOrder,
            ) === 0
          );
        })
        .sort((left, right) => {
          const priorityDiff =
            getRuntimeQueuePriority(
              left.gameSlot.category,
              GameStatus.READY,
              left.scheduledStartAt,
              now,
            ) -
            getRuntimeQueuePriority(
              right.gameSlot.category,
              GameStatus.READY,
              right.scheduledStartAt,
              now,
            );
          if (priorityDiff !== 0) {
            return priorityDiff;
          }

          return compareSortOrder(
            left.gameSlot.sortOrder,
            right.gameSlot.sortOrder,
          );
        });

      for (const dueSession of prioritizedDueSessions) {
        const handled = await this.processDueSession(
          dueSession.id,
          dueSession.gameSlotId,
        );
        if (handled) {
          break;
        }
      }

      // Deferred READY open behind live: throttle — running every tick under
      // Big Game load was competing with auto-call / Socket.IO for Prisma.
      if (Date.now() - this.lastOpenNextAtMs >= 10_000) {
        this.lastOpenNextAtMs = Date.now();
        await this.postGameRegistrationOpenerService.openNextAutoQueueRegistration(
          {
            allowBehindActiveLive: true,
            countdownMode: 'deferred',
          },
        );
      }
    } catch (error) {
      this.logger.error(
        'Auto-start scheduler tick failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.ticking = false;
    }
  }

  private async findStandardReadyHeadSortOrder(): Promise<number | null> {
    const readySessions = await this.prisma.gameSession.findMany({
      where: {
        status: GameStatus.READY,
        gameSlot: {
          status: { not: GameStatus.CANCELLED },
        },
      },
      select: {
        gameSlot: {
          select: {
            category: true,
            sortOrder: true,
          },
        },
      },
    });

    const head = readySessions
      .filter((session) => isStandardQueueCategory(session.gameSlot.category))
      .sort((left, right) =>
        compareSortOrder(left.gameSlot.sortOrder, right.gameSlot.sortOrder),
      )[0];

    return head?.gameSlot.sortOrder ?? null;
  }

  private async processDueSession(
    sessionId: string,
    slotId: string,
  ): Promise<boolean> {
    const activeSession = await this.prisma.gameSession.findFirst({
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
      return true;
    }

    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        gameSlotId: true,
        status: true,
        scheduledStartAt: true,
        roundIndex: true,
        _count: {
          select: {
            gameCartelas: {
              where: { status: { not: 'CANCELLED' } },
            },
          },
        },
        gameSlot: {
          select: {
            id: true,
            category: true,
            operationMode: true,
            autoCallIntervalSeconds: true,
          },
        },
      },
    });

    if (!session || session.status !== GameStatus.READY) {
      return false;
    }

    const isBigGame = isBigGameCategory(session.gameSlot.category);
    if (
      !isBigGame &&
      session.gameSlot.operationMode !== GameOperationMode.AUTO
    ) {
      return false;
    }

    // Open-ended Big Game next-round READY (null scheduledStartAt) stays
    // registrable until finalize arms the inter-round delay — never auto-start.
    if (isBigGame && session.scheduledStartAt == null) {
      return false;
    }

    // Refuse to start a later Big Game round while an earlier round is still live.
    if (isBigGame) {
      const earlierLive = await this.prisma.gameSession.findFirst({
        where: {
          gameSlotId: slotId,
          status: {
            in: [
              GameStatus.PLAYING,
              GameStatus.WINNER_WINDOW,
              GameStatus.CHECKING,
            ],
          },
          roundIndex: { lt: session.roundIndex ?? 1 },
        },
        select: { id: true },
      });
      if (earlierLive) {
        return true;
      }
    }

    if (!isBigGame) {
      const claimResult = await this.prisma.gameSession.updateMany({
        where: {
          id: sessionId,
          status: GameStatus.READY,
          scheduledStartAt: { lte: new Date() },
        },
        data: { scheduledStartAt: null },
      });

      if (claimResult.count !== 1) {
        return false;
      }
    }

    if (session._count.gameCartelas === 0) {
      const cancelResult = await this.gameLifecycleService.cancelSession(
        sessionId,
        'no_players',
        { abortIfPlayersRegistered: true },
      );

      if (!cancelResult.aborted) {
        return true;
      }
      // A registration landed while we were cancelling — start the game instead.
    }

    try {
      const startedSession = await this.gameEngineService.startGame(slotId);
      // Big Game is always auto-called; standard AUTO queue games too.
      if (isBigGame || session.gameSlot.operationMode === GameOperationMode.AUTO) {
        const intervalSeconds =
          session.gameSlot.autoCallIntervalSeconds ??
          (await this.gameTimingConfigService.getAutoCallIntervalSeconds());

        await this.prisma.gameSession.update({
          where: { id: startedSession.id },
          data: {
            autoCallIntervalMs: intervalSeconds * 1000,
          },
        });

        await this.autoCallService.startAutoCall(startedSession.id, {
          callFirstImmediately: true,
        });
      }
      return true;
    } catch (error) {
      if (!isBigGame) {
        await this.prisma.gameSession.updateMany({
          where: {
            id: sessionId,
            status: GameStatus.READY,
            scheduledStartAt: null,
          },
          data: {
            // Keep the session due for retry instead of re-opening a fresh
            // registration countdown after players already registered.
            scheduledStartAt: new Date(),
          },
        });
      }

      this.logger.warn(
        `Auto-start failed for session ${sessionId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      return true;
    }
  }
}
