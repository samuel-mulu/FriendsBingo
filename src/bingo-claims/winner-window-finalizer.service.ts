import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { GameStatus } from '@prisma/client';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly bingoClaimsService: BingoClaimsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    if (this.ticking) {
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
        select: { id: true },
        orderBy: { winnerWindowEndsAt: 'asc' },
      });

      if (expiredSessions.length > 0) {
        this.logger.log(
          `Finalizing ${expiredSessions.length} expired winner window session(s)`,
        );
      }

      for (const session of expiredSessions) {
        try {
          await this.bingoClaimsService.finalizeWinnerWindow(session.id);
        } catch (error) {
          this.logger.error(
            `Failed to finalize winner window for session ${session.id}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}
