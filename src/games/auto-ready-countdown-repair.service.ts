import { Injectable } from '@nestjs/common';
import { GameOperationMode, GameStatus } from '@prisma/client';
import { GameTimingConfigService } from '../game-timing-config/game-timing-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { OperationsCacheService } from './operations-cache.service';
import { serializeGameSession, toPlayerGameSession } from './games.mapper';
import { gameSessionSelect } from './games.select';

export const AUTO_COUNTDOWN_REPAIRED_REASON = 'auto_countdown_repaired';

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

  async ensureAutoReadySessionHasCountdown(
    sessionId: string,
  ): Promise<RepairResult> {
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
    const sessions = await this.prisma.gameSession.findMany({
      where: {
        status: GameStatus.READY,
        scheduledStartAt: null,
        gameSlot: {
          operationMode: GameOperationMode.AUTO,
          status: { not: GameStatus.CANCELLED },
        },
      },
      select: { id: true },
    });

    let repairedCount = 0;
    for (const session of sessions) {
      const result = await this.ensureAutoReadySessionHasCountdown(session.id);
      if (result.repaired) {
        repairedCount += 1;
      }
    }

    return repairedCount;
  }

  /// Early registration during post-game review is intentional; keep as no-op.
  async repairEarlyReadyCountdownsDuringReviewGrace(): Promise<number> {
    return 0;
  }
}
