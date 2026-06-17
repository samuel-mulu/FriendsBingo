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
  private readonly instanceId = Math.random().toString(36).slice(2, 8);
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
    if (process.env.AUTO_CALL_DEBUG === 'true') {
      this.logger.log(
        `[AutoCall] scheduler started instance=${this.instanceId} tickMs=${TICK_MS}`,
      );
    }
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

  async startAutoCall(
    sessionId: string,
    options?: { callFirstImmediately?: boolean },
  ) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        autoCallIntervalMs: true,
        _count: { select: { calledNumbers: true } },
      },
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

    const shouldCallFirstImmediately =
      options?.callFirstImmediately === true &&
      session._count.calledNumbers === 0;

    if (shouldCallFirstImmediately) {
      // Call first ball immediately, then set nextAutoCallAt for the second ball
      const now = new Date();
      const nextAutoCallAt = new Date(now.getTime() + intervalMs);

      // Set auto-call enabled with next tick scheduled
      await this.prisma.gameSession.update({
        where: { id: sessionId },
        data: {
          autoCallEnabled: true,
          nextAutoCallAt,
        },
      });

      void this.emitAutoCallChanged(sessionId);

      // Call the first ball immediately (outside transaction to avoid blocking)
      try {
        const payload = await this.calledNumbersService.callRandomNumber(
          sessionId,
        );
        if (process.env.AUTO_CALL_DEBUG === 'true') {
          const draw = payload as {
            number?: number;
            order?: number;
            nextAutoCallAt?: string | null;
          };
          this.logger.log(
            `Auto-call started for session ${sessionId}; first ball #${draw.number ?? '?'} called immediately; next ball in ${intervalMs}ms`,
          );
        }
      } catch (error) {
        // Log error but keep auto-call enabled - tick() will retry on next interval
        this.logger.error(
          `Immediate first ball call failed for session ${sessionId}: ${this.getErrorMessage(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
        // Don't throw - auto-call is still enabled and will retry
      }

      return { success: true, sessionId, autoCallEnabled: true, firstBallCalled: true };
    }

    // Standard path: first ball after interval
    await this.prisma.gameSession.update({
      where: { id: sessionId },
      data: {
        autoCallEnabled: true,
        nextAutoCallAt: new Date(Date.now() + intervalMs),
      },
    });

    void this.emitAutoCallChanged(sessionId);
    if (process.env.AUTO_CALL_DEBUG === 'true') {
      this.logger.log(
        `Auto-call started for session ${sessionId}; first ball in ${intervalMs}ms`,
      );
    }
    return { success: true, sessionId, autoCallEnabled: true, firstBallCalled: false };
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

    const sessionBefore =
      process.env.AUTO_CALL_DEBUG === 'true'
        ? await this.prisma.gameSession.findUnique({
            where: { id: sessionId },
            select: { nextAutoCallAt: true },
          })
        : null;

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

    if (process.env.AUTO_CALL_DEBUG === 'true') {
      this.logger.log(
        `[AutoCall] claimed session=${sessionId} instance=${this.instanceId} claimAt=${now.toISOString()} nextAutoCallAt ${sessionBefore?.nextAutoCallAt?.toISOString() ?? 'null'} -> ${nextAutoCallAt.toISOString()} (intervalMs=${delayMs})`,
      );
    }

    const callStartedAt = Date.now();
    try {
      const payload = await this.calledNumbersService.callRandomNumber(sessionId);
      if (process.env.AUTO_CALL_DEBUG === 'true') {
        const callDurationMs = Date.now() - callStartedAt;
        const draw = payload as {
          number?: number;
          order?: number;
          nextAutoCallAt?: string | null;
        };
        this.logger.log(
          `[AutoCall] draw completed session=${sessionId} number=${draw.number ?? '?'} order=${draw.order ?? '?'} callDurationMs=${callDurationMs} nextAutoCallAt=${draw.nextAutoCallAt ?? nextAutoCallAt.toISOString()}`,
        );
      }
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
