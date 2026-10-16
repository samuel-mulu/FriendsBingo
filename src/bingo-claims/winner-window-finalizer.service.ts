import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import { ObservabilityService } from '../observability/observability.service';
import { PrismaService } from '../prisma/prisma.service';
import { BingoClaimsService } from './bingo-claims.service';

const TICK_MS = 1000;

@Injectable()
export class WinnerWindowFinalizerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WinnerWindowFinalizerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bingoClaimsService: BingoClaimsService,
    private readonly observability: ObservabilityService,
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
      const expiredSessions = await this.prisma.gameSession.findMany({
        where: {
          status: GameStatus.WINNER_WINDOW,
          winnerWindowEndsAt: { lte: new Date() },
          prizeFinalizedAt: null,
        },
        select: { id: true, winnerWindowEndsAt: true },
        orderBy: { winnerWindowEndsAt: 'asc' },
      });

      if (expiredSessions.length > 0) {
        this.logger.log(
          `event=winner_window.finalization_batch count=${expiredSessions.length}`,
        );
      }

      for (const session of expiredSessions) {
        const startedAt = Date.now();
        const deadlineLagMs = session.winnerWindowEndsAt
          ? startedAt - session.winnerWindowEndsAt.getTime()
          : null;
        try {
          this.logger.log(
            `event=winner_window.finalization_started sessionId=${session.id} deadlineLagMs=${deadlineLagMs ?? 'null'}`,
          );
          await this.bingoClaimsService.finalizeWinnerWindow(session.id);
          const durationMs = Date.now() - startedAt;
          this.observability.recordWinnerWindowFinalization({
            durationMs,
            deadlineLagMs,
            result: 'success',
          });
          this.logger.log(
            `event=winner_window.finalization_committed sessionId=${session.id} durationMs=${durationMs} deadlineLagMs=${deadlineLagMs ?? 'null'}`,
          );
        } catch (error) {
          const durationMs = Date.now() - startedAt;
          this.observability.recordWinnerWindowFinalization({
            durationMs,
            deadlineLagMs,
            result: 'failure',
          });
          this.logger.error(
            `event=winner_window.finalization_failed sessionId=${session.id} durationMs=${durationMs} error=${
              error instanceof Error ? error.message : String(error)
            }`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        'event=winner_window.finalizer_tick_failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.ticking = false;
    }
  }
}
