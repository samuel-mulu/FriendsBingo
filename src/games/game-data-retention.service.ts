import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GameStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const TICK_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = 500;

@Injectable()
export class GameDataRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameDataRetentionService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    void this.runRetention();
    this.timer = setInterval(() => {
      void this.runRetention();
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runRetention(now = new Date()) {
    if (this.ticking) {
      return;
    }

    const retentionDays = this.configService.get<number>(
      'GAME_DETAIL_RETENTION_DAYS',
      90,
    );
    if (!retentionDays || retentionDays <= 0) {
      return;
    }

    this.ticking = true;
    try {
      const cutoff = new Date(now);
      cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);

      const sessions = await this.prisma.gameSession.findMany({
        where: {
          OR: [
            {
              status: { in: [GameStatus.FINISHED, GameStatus.CANCELLED] },
              finishedAt: { lte: cutoff },
            },
            {
              status: GameStatus.CANCELLED,
              finishedAt: null,
              updatedAt: { lte: cutoff },
            },
          ],
        },
        select: { id: true },
        take: BATCH_SIZE,
      });

      if (sessions.length === 0) {
        return;
      }

      const sessionIds = sessions.map((session) => session.id);
      const [calledNumbers, claims, cartelas] = await Promise.all([
        this.prisma.calledNumber.deleteMany({
          where: { gameSessionId: { in: sessionIds } },
        }),
        this.prisma.bingoClaim.deleteMany({
          where: { gameSessionId: { in: sessionIds } },
        }),
        this.prisma.gameCartela.deleteMany({
          where: { gameSessionId: { in: sessionIds } },
        }),
      ]);

      this.logger.log(
        `Retention archived sessions=${sessionIds.length} calledNumbers=${calledNumbers.count} bingoClaims=${claims.count} gameCartelas=${cartelas.count} cutoff=${cutoff.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(
        `Retention job failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.ticking = false;
    }
  }
}
