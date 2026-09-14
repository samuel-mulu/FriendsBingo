import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { GameCategory, GameStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AutoCallService } from './auto-call.service';
import { ChainRoundService } from './chain-round.service';
import { isChainDebugEnabled } from './chain-round.util';
import { OperationsCacheService } from './operations-cache.service';

const TICK_MS = 1000;

/**
 * Resumes a CHAIN_GAME session once its inter-round pause elapses.
 *
 * The session never left PLAYING, so there is no game to "start" — this only has
 * to clear `roundPausedUntil` and switch auto-call back on. Scoped to
 * CHAIN_GAME sessions, so no other category can be observed by this tick.
 */
@Injectable()
export class ChainRoundResumeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChainRoundResumeService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly autoCallService: AutoCallService,
    private readonly chainRoundService: ChainRoundService,
    private readonly operationsCacheService: OperationsCacheService,
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
          status: GameStatus.PLAYING,
          roundPausedUntil: { lte: new Date() },
          gameSlot: { category: GameCategory.CHAIN_GAME },
        },
        select: {
          id: true,
          gameSlotId: true,
          roundIndex: true,
          roundPrizeAmount: true,
          gameRuleId: true,
          gameSlot: { select: { roundCount: true } },
        },
        orderBy: { roundPausedUntil: 'asc' },
      });

      for (const session of dueSessions) {
        try {
          await this.resumeSession(session);
        } catch (error) {
          this.logger.error(
            `Failed to resume chain round for session ${session.id}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        'Chain round resume tick failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.ticking = false;
    }
  }

  private async resumeSession(session: {
    id: string;
    gameSlotId: string;
    roundIndex: number;
    roundPrizeAmount: { toString(): string } | null;
    gameRuleId: string | null;
    gameSlot: { roundCount: number };
  }) {
    // Conditional clear doubles as the claim lock: only one worker can win it.
    const cleared = await this.prisma.gameSession.updateMany({
      where: {
        id: session.id,
        status: GameStatus.PLAYING,
        roundPausedUntil: { not: null },
      },
      data: { roundPausedUntil: null },
    });

    if (cleared.count !== 1) {
      return;
    }

    this.logger.log(
      `Chain round ${session.roundIndex} resuming on session ${session.id}`,
    );
    if (isChainDebugEnabled()) {
      this.logger.log(
        `[chain] resume round ${session.roundIndex} session=${session.id} ` +
          `startAutoCall`,
      );
    }

    this.operationsCacheService.invalidate();

    this.chainRoundService.emitRoundStarted({
      sessionId: session.id,
      slotId: session.gameSlotId,
      roundIndex: session.roundIndex,
      roundCount: session.gameSlot.roundCount ?? 1,
      roundPrizeAmount: session.roundPrizeAmount?.toString() ?? '0',
      gameRuleId: session.gameRuleId,
    });

    // The draw continues from where it stopped, so the next ball follows the
    // normal interval rather than firing immediately.
    await this.autoCallService.startAutoCall(session.id);
  }
}
