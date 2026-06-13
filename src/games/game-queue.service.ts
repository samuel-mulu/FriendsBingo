import { BadRequestException, Injectable } from '@nestjs/common';
import { GameStatus, Prisma } from '@prisma/client';

import {
  assertTopFiveQueueRuleDiversity,
  resolveInsertAfterSortOrder,
  shouldDeferDuplicateRuleInTopFive,
} from './game-queue-diversity';

type QueueDbClient = Prisma.TransactionClient;

export {
  QUEUE_RULE_DIVERSITY_MESSAGE,
  QUEUE_RULE_DIVERSITY_WINDOW,
} from './game-queue-diversity';

@Injectable()
export class GameQueueService {
  async listQueueOrderingSlots(tx: QueueDbClient) {
    return tx.gameSlot.findMany({
      where: { status: GameStatus.NEXT },
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

  async assertSlotReady(tx: QueueDbClient, slotId: string): Promise<void> {
    const slot = await tx.gameSlot.findUnique({
      where: { id: slotId },
      select: { status: true, sortOrder: true },
    });

    if (!slot) {
      throw new BadRequestException('Game slot not found');
    }

    if (slot.status !== GameStatus.NEXT && slot.status !== GameStatus.READY) {
      throw new BadRequestException(
        `Cannot start game: slot is ${slot.status}. Only NEXT or READY slots can be started.`,
      );
    }

    const firstSlot = await tx.gameSlot.findFirst({
      where: {
        status: {
          in: [GameStatus.NEXT, GameStatus.READY],
        },
      },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });

    if (firstSlot?.id !== slotId) {
      throw new BadRequestException(
        'Only the first slot in the queue can be started',
      );
    }
  }
}
