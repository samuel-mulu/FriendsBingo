import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const AUTO_CALL_OVERDUE_MS = 5 * 60 * 1000;
const SCHEDULED_START_OVERDUE_GRACE_MS = 30 * 1000;

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth() {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');

      const now = new Date();
      const autoCallCutoff = new Date(now.getTime() - AUTO_CALL_OVERDUE_MS);

      const scheduledStartCutoff = new Date(
        now.getTime() - SCHEDULED_START_OVERDUE_GRACE_MS,
      );

      const [overdueWinnerWindows, overdueAutoCall, overdueScheduledStart] =
        await Promise.all([
          this.prisma.gameSession.count({
            where: {
              status: GameStatus.WINNER_WINDOW,
              winnerWindowEndsAt: { lte: now },
              prizeFinalizedAt: null,
            },
          }),
          this.prisma.gameSession.count({
            where: {
              status: GameStatus.PLAYING,
              autoCallEnabled: true,
              nextAutoCallAt: { lte: autoCallCutoff },
            },
          }),
          this.prisma.gameSession.count({
            where: {
              status: GameStatus.READY,
              scheduledStartAt: { lte: scheduledStartCutoff },
            },
          }),
        ]);

      const stuckSessions = {
        overdueWinnerWindows,
        overdueAutoCall,
        overdueScheduledStart,
      };

      const hasStuckSessions =
        overdueWinnerWindows > 0 ||
        overdueAutoCall > 0 ||
        overdueScheduledStart > 0;

      return {
        status: hasStuckSessions ? 'degraded' : 'ok',
        uptime: process.uptime(),
        database: 'up',
        timestamp: now.toISOString(),
        schedulers: {
          autoCall: true,
          winnerWindowFinalizer: true,
          gameAutoStart: true,
        },
        stuckSessions,
      };
    } catch {
      throw new ServiceUnavailableException({
        message: 'Database connectivity check failed',
        error: 'Service Unavailable',
        database: 'down',
      });
    }
  }
}
