import { Injectable } from '@nestjs/common';
import { GameOperationMode, GameStatus } from '@prisma/client';
import { GameTimingConfigService } from '../game-timing-config/game-timing-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { OperationsCacheService } from './operations-cache.service';
import { serializeGameSession, toPlayerGameSession } from './games.mapper';
import { gameSessionSelect } from './games.select';
import {
  compareSortOrder,
  isStandardQueueCategory,
} from './game-category.util';

export const AUTO_COUNTDOWN_REPAIRED_REASON = 'auto_countdown_repaired';

const BLOCKING_SESSION_STATUSES: GameStatus[] = [
  GameStatus.PLAYING,
  GameStatus.WINNER_WINDOW,
  GameStatus.CHECKING,
];

type RepairResult =
  | {
      repaired: true;
      sessionId: string;
      slotId: string;
      scheduledStartAt: Date;
    }
  | { repaired: false };

@Injectable()
export class AutoReadyCountdownRepairService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameTimingConfigService: GameTimingConfigService,
    private readonly operationsCacheService: OperationsCacheService,
    private readonly realtimeService: RealtimeService,
  ) {}

  private async hasActiveBlockingSession(): Promise<boolean> {
    const activeSession = await this.prisma.gameSession.findFirst({
      where: { status: { in: BLOCKING_SESSION_STATUSES } },
      select: { id: true },
    });

    return activeSession != null;
  }

  /// READY sessions whose countdown expired while another round was still live
  /// keep registration closed on AUTO. Clear the stale deadline so early-queue
  /// registration can stay open until the live round finishes.
  async repairBlockedExpiredReadyCountdowns(): Promise<number> {
    if (!(await this.hasActiveBlockingSession())) {
      return 0;
    }

    const result = await this.prisma.gameSession.updateMany({
      where: {
        status: GameStatus.READY,
        scheduledStartAt: { lte: new Date() },
        gameSlot: {
          operationMode: GameOperationMode.AUTO,
          status: { not: GameStatus.CANCELLED },
        },
      },
      data: { scheduledStartAt: null },
    });

    if (result.count > 0) {
      this.operationsCacheService.invalidate();
    }

    return result.count;
  }

  async ensureAutoReadySessionHasCountdown(
    sessionId: string,
  ): Promise<RepairResult> {
    if (await this.hasActiveBlockingSession()) {
      return { repaired: false };
    }

    const registrationDurationSeconds =
      await this.gameTimingConfigService.getRegistrationDurationSeconds();
    const scheduledStartAt = new Date(
      Date.now() + registrationDurationSeconds * 1000,
    );

    const claim = await this.prisma.gameSession.updateMany({
      where: {
        id: sessionId,
        status: GameStatus.READY,
        scheduledStartAt: null,
        gameSlot: {
          operationMode: GameOperationMode.AUTO,
          status: { not: GameStatus.CANCELLED },
        },
      },
      data: { scheduledStartAt },
    });

    if (claim.count !== 1) {
      return { repaired: false };
    }

    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: gameSessionSelect,
    });

    if (!session) {
      return { repaired: false };
    }

    this.operationsCacheService.invalidate();

    const adminPayload = {
      ...serializeGameSession(session),
      updatedReason: AUTO_COUNTDOWN_REPAIRED_REASON,
    };
    const publicPayload = {
      ...toPlayerGameSession(adminPayload),
      updatedReason: AUTO_COUNTDOWN_REPAIRED_REASON,
    };

    this.realtimeService.emitGameOperationUpdate({
      slotId: session.gameSlotId,
      sessionId: session.id,
      adminPayload,
      publicPayload,
    });

    return {
      repaired: true,
      sessionId: session.id,
      slotId: session.gameSlotId,
      scheduledStartAt: session.scheduledStartAt ?? scheduledStartAt,
    };
  }

  async repairAllMissingAutoReadyCountdowns(): Promise<number> {
    await this.repairBlockedExpiredReadyCountdowns();

    if (await this.hasActiveBlockingSession()) {
      return 0;
    }

    const sessions = await this.prisma.gameSession.findMany({
      where: {
        status: GameStatus.READY,
        scheduledStartAt: null,
        gameSlot: {
          operationMode: GameOperationMode.AUTO,
          status: { not: GameStatus.CANCELLED },
        },
      },
      select: {
        id: true,
        gameSlot: {
          select: {
            category: true,
            sortOrder: true,
          },
        },
      },
    });

    const headSession = [...sessions]
      .filter((session) => isStandardQueueCategory(session.gameSlot.category))
      .sort((left, right) =>
        compareSortOrder(left.gameSlot.sortOrder, right.gameSlot.sortOrder),
      )[0];

    if (!headSession) {
      return 0;
    }

    const result = await this.ensureAutoReadySessionHasCountdown(
      headSession.id,
    );
    return result.repaired ? 1 : 0;
  }

  /// Early registration during post-game review is intentional; keep as no-op.
  async repairEarlyReadyCountdownsDuringReviewGrace(): Promise<number> {
    return 0;
  }
}
