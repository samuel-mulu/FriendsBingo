import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import { CalledNumbersService } from '../called-numbers/called-numbers.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

export const DEFAULT_AUTO_CALL_INTERVAL_MS = 7000;
const TICK_MS = 1000;

@Injectable()
export class AutoCallService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly calledNumbersService: CalledNumbersService,
    private readonly realtimeService: RealtimeService,
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
      session.autoCallIntervalMs ?? DEFAULT_AUTO_CALL_INTERVAL_MS;

    await this.prisma.gameSession.update({
      where: { id: sessionId },
      data: {
        autoCallEnabled: true,
        nextAutoCallAt: new Date(Date.now() + intervalMs),
      },
    });

    this.emitAutoCallChanged(sessionId);
    return { success: true, sessionId, autoCallEnabled: true };
  }

  async stopAutoCall(sessionId: string) {
    await this.disableAutoCall(sessionId);
    this.emitAutoCallChanged(sessionId);
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
    if (this.ticking) {
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
    } finally {
      this.ticking = false;
    }
  }

  private async processSession(sessionId: string, intervalMs: number) {
    const delayMs = intervalMs ?? DEFAULT_AUTO_CALL_INTERVAL_MS;

    try {
      await this.calledNumbersService.callRandomNumber(sessionId);
      await this.prisma.gameSession.update({
        where: { id: sessionId },
        data: {
          nextAutoCallAt: new Date(Date.now() + delayMs),
        },
      });
    } catch {
      await this.disableAutoCall(sessionId);
      this.emitAutoCallChanged(sessionId);
    }
  }

  private emitAutoCallChanged(sessionId: string) {
    this.realtimeService.emitToAdmin('game:operation_updated', {
      sessionId,
      updatedReason: 'auto_call_changed',
    });
    this.realtimeService.emitToPublicGames('game:operation_updated', {
      sessionId,
      updatedReason: 'auto_call_changed',
    });
  }
}
