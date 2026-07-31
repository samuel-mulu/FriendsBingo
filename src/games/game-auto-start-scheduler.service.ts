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
import { PostGameRegistrationOpenerService } from './post-game-registration-opener.service';

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
    private readonly gameLifecycleService: GameLifecycleService,
    private readonly gameTimingConfigService: GameTimingConfigService,
    private readonly autoReadyCountdownRepairService: AutoReadyCountdownRepairService,
    private readonly postGameRegistrationOpenerService: PostGameRegistrationOpenerService,
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

      const dueSessions = await this.prisma.gameSession.findMany({
        where: {
          status: GameStatus.READY,
          scheduledStartAt: { lte: now },
        },
        select: {
          id: true,
          gameSlotId: true,
          scheduledStartAt: true,
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

      // Deferred options let this tick reopen the queue head behind a live
      // round, so a single failed open at PLAYING time (lock contention,
      // review grace, transient error) no longer strands the queue for the
      // whole round. The opener is idempotent and a deferred READY gets no
      // countdown, so it cannot start behind the live session.
      await this.postGameRegistrationOpenerService.openNextAutoQueueRegistration(
        {
          allowBehindActiveLive: true,
          countdownMode: 'deferred',
        },
      );
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

    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        gameSlotId: true,
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

    const isBigGame = isBigGameCategory(session?.gameSlot.category);
    if (
      !session ||
      (!isBigGame && session.gameSlot.operationMode !== GameOperationMode.AUTO)
    ) {
      return true;
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
      if (session.gameSlot.operationMode === GameOperationMode.AUTO) {
        const intervalSeconds =
          await this.gameTimingConfigService.getAutoCallIntervalSeconds();

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

      this.logger.warn(
        `Auto-start failed for session ${sessionId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      return true;
    }
  }
}
