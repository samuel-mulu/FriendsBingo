import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import {
  AutoCallClaimLostError,
  CalledNumbersService,
} from '../called-numbers/called-numbers.service';
import { GameEngineService } from '../game-engine/game-engine.service';
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
  private readonly processingSessionIds = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gameTimingConfigService: GameTimingConfigService,
    private readonly calledNumbersService: CalledNumbersService,
    @Optional()
    private readonly gameEngineService: GameEngineService,
    @Optional()
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
        gameSlotId: true,
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

      // Call the first ball immediately (outside transaction to avoid blocking)
      try {
        const payload =
          await this.calledNumbersService.callRandomNumber(sessionId);
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

      void this.emitAutoCallChanged(sessionId, {
        slotId: session.gameSlotId,
        autoCallEnabled: true,
        autoCallIntervalMs: intervalMs,
        nextAutoCallAt: nextAutoCallAt.toISOString(),
      });

      return {
        success: true,
        sessionId,
        autoCallEnabled: true,
        firstBallCalled: true,
      };
    }

    // Standard path: first ball after interval
    await this.prisma.gameSession.update({
      where: { id: sessionId },
      data: {
        autoCallEnabled: true,
        nextAutoCallAt: new Date(Date.now() + intervalMs),
      },
    });

    void this.emitAutoCallChanged(sessionId, {
      slotId: session.gameSlotId,
      autoCallEnabled: true,
      autoCallIntervalMs: intervalMs,
      nextAutoCallAt: new Date(Date.now() + intervalMs).toISOString(),
    });
    if (process.env.AUTO_CALL_DEBUG === 'true') {
      this.logger.log(
        `Auto-call started for session ${sessionId}; first ball in ${intervalMs}ms`,
      );
    }
    return {
      success: true,
      sessionId,
      autoCallEnabled: true,
      firstBallCalled: false,
    };
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
          nextAutoCallAt: true,
        },
        orderBy: { nextAutoCallAt: 'asc' },
      });

      if (dueSessions.length > 0) {
        this.logger.log(
          `[AutoCall] event=auto_call_tick_started instance=${this.instanceId} dueCount=${dueSessions.length}`,
        );
      }

      for (const session of dueSessions) {
        await this.processSession(
          session.id,
          session.autoCallIntervalMs,
          session.nextAutoCallAt, // scheduled due — metrics only
        );
      }

      await this.gameEngineService?.finalizeExpiredNoWinnerSessions?.();
    } catch (error) {
      this.logger.error(
        'Auto-call scheduler tick failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.ticking = false;
    }
  }

  private async processSession(
    sessionId: string,
    intervalMs: number | null,
    scheduledDueAt: Date | null,
  ) {
    if (this.processingSessionIds.has(sessionId)) {
      this.logger.warn(
        `[AutoCall] event=skipped_overlap sessionId=${sessionId}`,
      );
      return;
    }

    this.processingSessionIds.add(sessionId);

    const delayMs =
      intervalMs ??
      (await this.gameTimingConfigService.getAutoCallIntervalMs());
    const now = new Date();
    const nextAutoCallAt = new Date(now.getTime() + delayMs);
    const metricsScheduledDueAt = scheduledDueAt ?? now;
    try {
      const result =
        await this.calledNumbersService.callRandomNumberForAutoCall(sessionId, {
          intervalMs: delayMs,
          scheduledDueAt: metricsScheduledDueAt,
          nextAutoCallAt,
        });
      const emitStartedAt = Date.now();
      this.emitNumberCalled(result.payload);
      this.emitAutoCallChanged(sessionId, {
        slotId: result.autoCallChangedPayload.slotId,
        autoCallEnabled: result.autoCallChangedPayload.autoCallEnabled,
        autoCallIntervalMs: result.autoCallChangedPayload.autoCallIntervalMs,
        nextAutoCallAt: result.autoCallChangedPayload.nextAutoCallAt,
      });
      const emitMs = Date.now() - emitStartedAt;
      this.logger.log(
        `[AutoCall] event=draw_committed sessionId=${sessionId} number=${result.payload.number} order=${result.payload.order} transaction_ms=${result.transactionMs} emit_ms=${emitMs} delayed_by_ms=${result.delayedByMs}`,
      );
    } catch (error) {
      if (error instanceof AutoCallClaimLostError) {
        this.logger.warn(
          `[AutoCall] event=skipped_overlap sessionId=${sessionId} reason=claim_lost`,
        );
        return;
      }

      if (this.isTerminalAutoCallError(error)) {
        this.logger.warn(
          `Disabling auto-call for session ${sessionId}: ${this.getErrorMessage(error)}`,
        );
        await this.disableAutoCall(sessionId);
        void this.emitAutoCallChanged(sessionId);
        return;
      }

      this.logger.warn(
        `Transient auto-call error for session ${sessionId}; will retry on next tick: ${this.getErrorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.processingSessionIds.delete(sessionId);
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

  private emitNumberCalled(payload: Record<string, unknown>) {
    if (!this.realtimeService) {
      this.logger.warn(
        `[AutoCall] event=emit_skipped reason=realtime_unavailable event=game:number_called sessionId=${String(payload.sessionId ?? '')}`,
      );
      return;
    }

    this.realtimeService.emitToGame(
      payload.sessionId as string,
      'game:number_called',
      payload,
    );
    this.realtimeService.emitToAdmin('game:number_called', payload);
    this.realtimeService.emitToPublicGames('game:number_called', payload);
  }

  private async emitAutoCallChanged(
    sessionId: string,
    override?: {
      slotId: string | null;
      autoCallEnabled: boolean;
      autoCallIntervalMs: number | null;
      nextAutoCallAt: string | null;
    },
  ) {
    const state = override
      ? override
      : await this.prisma.gameSession
          .findUnique({
            where: { id: sessionId },
            select: {
              autoCallEnabled: true,
              autoCallIntervalMs: true,
              nextAutoCallAt: true,
              gameSlotId: true,
            },
          })
          .then((session) => ({
            slotId: session?.gameSlotId ?? null,
            autoCallEnabled: session?.autoCallEnabled ?? false,
            autoCallIntervalMs: session?.autoCallIntervalMs ?? null,
            nextAutoCallAt: session?.nextAutoCallAt?.toISOString() ?? null,
          }));

    const payload = {
      sessionId,
      slotId: state.slotId,
      autoCallEnabled: state.autoCallEnabled,
      autoCallIntervalMs: state.autoCallIntervalMs,
      nextAutoCallAt: state.nextAutoCallAt,
      updatedReason: 'auto_call_changed',
    };

    if (!this.realtimeService) {
      this.logger.warn(
        `[AutoCall] event=emit_skipped reason=realtime_unavailable event=game:operation_updated sessionId=${sessionId}`,
      );
      return;
    }

    this.realtimeService.emitToAdmin('game:operation_updated', payload);
    this.realtimeService.emitToPublicGames('game:operation_updated', payload);
    this.realtimeService.emitToGame(
      sessionId,
      'game:operation_updated',
      payload,
    );
  }
}
