import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import { CalledNumbersService } from '../called-numbers/called-numbers.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

import { GameTimingConfigService } from '../game-timing-config/game-timing-config.service';

export { DEFAULT_AUTO_CALL_INTERVAL_MS } from '../game-timing-config/game-timing-config.defaults';
const TICK_MS = 1000;

@Injectable()
export class AutoCallService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoCallService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gameTimingConfigService: GameTimingConfigService,
    private readonly calledNumbersService: CalledNumbersService,
    private readonly realtimeService: RealtimeService,
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

  async startAutoCall(sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true, autoCallIntervalMs: true },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.status !== GameStatus.PLAYING) {
      throw new BadRequestException(
        'Auto-call only works for PLAYING sessions',
      );
    }

    const intervalMs =
      session.autoCallIntervalMs ??
      (await this.gameTimingConfigService.getAutoCallIntervalMs());

    await this.prisma.gameSession.update({
      where: { id: sessionId },
      data: {
        autoCallEnabled: true,
        nextAutoCallAt: new Date(Date.now() + intervalMs),
      },
    });

    void this.emitAutoCallChanged(sessionId);
    return { success: true, sessionId, autoCallEnabled: true };
  }

  async stopAutoCall(sessionId: string) {
    await this.disableAutoCall(sessionId);
    void this.emitAutoCallChanged(sessionId);
    return { success: true, sessionId, autoCallEnabled: false };
  }

  async disableAutoCall(sessionId: string) {
    await this.prisma.gameSession.updateMany({
      where: { id: sessionId, autoCallEnabled: true },
      data: {
        autoCallEnabled: false,
        nextAutoCallAt: null,
      },
    });
  }

  private async tick() {
    if (this.shuttingDown || this.ticking) {
      return;
    }

    this.ticking = true;

    try {
      const dueSessions = await this.prisma.gameSession.findMany({
        where: {
          autoCallEnabled: true,
          status: GameStatus.PLAYING,
          nextAutoCallAt: { lte: new Date() },
        },
        select: {
          id: true,
          autoCallIntervalMs: true,
        },
        orderBy: { nextAutoCallAt: 'asc' },
      });

      for (const session of dueSessions) {
        await this.processSession(session.id, session.autoCallIntervalMs);
      }
    } catch (error) {
      this.logger.error(
        'Auto-call scheduler tick failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.ticking = false;
    }
  }

  private async processSession(sessionId: string, intervalMs: number | null) {
    const delayMs =
      intervalMs ?? (await this.gameTimingConfigService.getAutoCallIntervalMs());
    const now = new Date();
    const nextAutoCallAt = new Date(now.getTime() + delayMs);

    const claimResult = await this.prisma.gameSession.updateMany({
      where: {
        id: sessionId,
        autoCallEnabled: true,
        status: GameStatus.PLAYING,
        nextAutoCallAt: { lte: now },
      },
      data: { nextAutoCallAt },
    });

    if (claimResult.count !== 1) {
      return;
    }

    try {
      await this.calledNumbersService.callRandomNumber(sessionId);
    } catch (error) {
      if (this.isTerminalAutoCallError(error)) {
        this.logger.warn(
          `Disabling auto-call for session ${sessionId}: ${this.getErrorMessage(error)}`,
        );
        await this.disableAutoCall(sessionId);
        void this.emitAutoCallChanged(sessionId);
        return;
      }

      await this.prisma.gameSession.updateMany({
        where: {
          id: sessionId,
          autoCallEnabled: true,
        },
        data: {
          nextAutoCallAt: new Date(),
        },
      });

      this.logger.warn(
        `Transient auto-call error for session ${sessionId}; will retry on next tick: ${this.getErrorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private isTerminalAutoCallError(error: unknown): boolean {
    if (error instanceof NotFoundException) {
      return true;
    }

    if (error instanceof BadRequestException) {
      const message = error.message.toLowerCase();
      return (
        message.includes('playing') ||
        message.includes('all numbers have been called')
      );
    }

    return false;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown error';
  }

  private async emitAutoCallChanged(sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        autoCallEnabled: true,
        autoCallIntervalMs: true,
        nextAutoCallAt: true,
        gameSlotId: true,
      },
    });

    const payload = {
      sessionId,
      slotId: session?.gameSlotId,
      autoCallEnabled: session?.autoCallEnabled ?? false,
      autoCallIntervalMs: session?.autoCallIntervalMs ?? null,
      nextAutoCallAt: session?.nextAutoCallAt ?? null,
      updatedReason: 'auto_call_changed',
    };

    this.realtimeService.emitToAdmin('game:operation_updated', payload);
    this.realtimeService.emitToPublicGames('game:operation_updated', payload);
  }
}
