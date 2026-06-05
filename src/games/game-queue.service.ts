import { BadRequestException, Injectable } from '@nestjs/common';
import { GameStatus, Prisma } from '@prisma/client';

type QueueDbClient = Prisma.TransactionClient;

@Injectable()
export class GameQueueService {
  async assignSortOrderOnCreate(
    tx: QueueDbClient,
  ): Promise<number> {
    const maxSortOrder = await tx.gameSlot.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    return (maxSortOrder?.sortOrder ?? 0) + 1;
  }

  async updateQueueOrder(tx: QueueDbClient, slotIds: string[]): Promise<void> {
    // Bulk update sortOrder based on the provided list of IDs (Drag-and-Drop)
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

    if (slot.status !== GameStatus.NEXT) {
      throw new BadRequestException('Only NEXT slots can be started');
    }

    // Optional: Check if it's the first in queue
    const firstSlot = await tx.gameSlot.findFirst({
      where: { status: GameStatus.NEXT },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });

    if (firstSlot?.id !== slotId) {
      throw new BadRequestException('Only the first slot in the queue can be started');
    }
  }

  private async listQueuedSlots(tx: QueueDbClient) {
    return tx.gameSlot.findMany({
      where: { status: GameStatus.NEXT },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, sortOrder: true },
    });
  }
}
