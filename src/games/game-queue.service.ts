import { BadRequestException, Injectable } from '@nestjs/common';
import { GameStatus, GameCategory, Prisma } from '@prisma/client';
import { GameLifecycleDebugLogger } from './game-lifecycle-debug-logger.service';

import {
  assertTopFiveQueueRuleDiversity,
  resolveInsertAfterSortOrder,
  shouldDeferDuplicateRuleInTopFive,
} from './game-queue-diversity';
import {
  compareSortOrder,
  isBigGameCategory,
  isDueBigGameReady,
} from './game-category.util';

type QueueDbClient = Prisma.TransactionClient;

export {
  QUEUE_RULE_DIVERSITY_MESSAGE,
  QUEUE_RULE_DIVERSITY_WINDOW,
} from './game-queue-diversity';

@Injectable()
export class GameQueueService {
  constructor(private readonly lifecycleLogger: GameLifecycleDebugLogger) {}
  async listQueueOrderingSlots(tx: QueueDbClient) {
    return tx.gameSlot.findMany({
      where: {
        status: GameStatus.NEXT,
        category: { not: GameCategory.BIG_GAME },
      },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, gameRuleId: true, sortOrder: true },
    });
  }

  async assignSortOrderOnCreate(
    tx: QueueDbClient,
    gameRuleId: string,
  ): Promise<number> {
    const queueSlots = await this.listQueueOrderingSlots(tx);

    if (queueSlots.length === 0) {
      const maxSortOrder = await tx.gameSlot.findFirst({
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });

      return (maxSortOrder?.sortOrder ?? 0) + 1;
    }

    if (!shouldDeferDuplicateRuleInTopFive(queueSlots, gameRuleId)) {
      const maxSortOrder = await tx.gameSlot.findFirst({
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });

      return (maxSortOrder?.sortOrder ?? 0) + 1;
    }

    const anchorSortOrder = resolveInsertAfterSortOrder(queueSlots);

    await tx.gameSlot.updateMany({
      where: {
        status: GameStatus.NEXT,
        sortOrder: { gt: anchorSortOrder },
      },
      data: {
        sortOrder: { increment: 1 },
      },
    });

    return anchorSortOrder + 1;
  }

  assertReorderRuleDiversity(
    orderedGameRuleIds: Array<string | null | undefined>,
  ): void {
    assertTopFiveQueueRuleDiversity(orderedGameRuleIds);
  }

  async updateQueueOrder(tx: QueueDbClient, slotIds: string[]): Promise<void> {
    for (let i = 0; i < slotIds.length; i++) {
      await tx.gameSlot.update({
        where: { id: slotIds[i] },
        data: { sortOrder: i + 1 },
      });
    }
  }

  async moveSlotToBack(tx: QueueDbClient, slotId: string): Promise<void> {
    const maxSortOrder = await tx.gameSlot.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    await tx.gameSlot.update({
      where: { id: slotId },
      data: {
        status: GameStatus.NEXT,
        sortOrder: (maxSortOrder?.sortOrder ?? 0) + 1,
      },
    });
  }

  async restoreSlotAfterSession(
    tx: QueueDbClient,
    slotId: string,
  ): Promise<'requeued' | 'removed'> {
    const slot = await tx.gameSlot.findUnique({
      where: { id: slotId },
      select: { removeAfterFinish: true, sortOrder: true },
    });

    if (slot?.removeAfterFinish) {
      await tx.gameSlot.update({
        where: { id: slotId },
        data: { status: GameStatus.CANCELLED },
      });

      this.lifecycleLogger?.queueRestored?.({
        slotId,
        result: 'removed',
        reason: 'session_finished',
      });

      return 'removed';
    }

    await this.moveSlotToBack(tx, slotId);

    const updatedSlot = await tx.gameSlot.findUnique({
      where: { id: slotId },
      select: { sortOrder: true },
    });

    this.lifecycleLogger?.queueRestored?.({
      slotId,
      result: 'requeued',
      newSortOrder: updatedSlot?.sortOrder ?? undefined,
      reason: 'session_finished',
    });

    return 'requeued';
  }

  async assertSlotReady(tx: QueueDbClient, slotId: string): Promise<void> {
    const slot = await tx.gameSlot.findUnique({
      where: { id: slotId },
      select: {
        status: true,
        sortOrder: true,
        category: true,
        sessions: {
          where: { status: GameStatus.READY },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { scheduledStartAt: true },
        },
      },
    });

    if (!slot) {
      throw new BadRequestException('Game slot not found');
    }

    if (slot.status !== GameStatus.NEXT && slot.status !== GameStatus.READY) {
      throw new BadRequestException(
        `Cannot start game: slot is ${slot.status}. Only NEXT or READY slots can be started.`,
      );
    }

    const candidateSlots = await tx.gameSlot.findMany({
      where: {
        status: {
          in: [GameStatus.NEXT, GameStatus.READY],
        },
      },
      select: {
        id: true,
        status: true,
        category: true,
        sortOrder: true,
        sessions: {
          where: { status: GameStatus.READY },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { scheduledStartAt: true },
        },
      },
    });

    const now = new Date();
    const dueBigGameSlot = [...candidateSlots]
      .filter((candidate) =>
        isDueBigGameReady(
          candidate.category,
          GameStatus.READY,
          candidate.sessions?.[0]?.scheduledStartAt ?? null,
          now,
        ),
      )
      .sort((left, right) => {
        const scheduledDiff =
          (left.sessions?.[0]?.scheduledStartAt?.getTime() ?? 0) -
          (right.sessions?.[0]?.scheduledStartAt?.getTime() ?? 0);
        if (scheduledDiff !== 0) {
          return scheduledDiff;
        }

        return compareSortOrder(left.sortOrder, right.sortOrder);
      })[0];

    if (dueBigGameSlot) {
      if (dueBigGameSlot.id !== slotId) {
        throw new BadRequestException(
          'A due Big Game must start before lower-priority games',
        );
      }

      return;
    }

    if (isBigGameCategory(slot.category)) {
      throw new BadRequestException(
        'Big Game can only start at or after its scheduled start time',
      );
    }

    const firstSlot = [...candidateSlots]
      .filter((candidate) => !isBigGameCategory(candidate.category))
      .sort((left, right) =>
        compareSortOrder(left.sortOrder, right.sortOrder),
      )[0];

    if (firstSlot?.id !== slotId) {
      throw new BadRequestException(
        'Only the first slot in the queue can be started',
      );
    }
  }
}
