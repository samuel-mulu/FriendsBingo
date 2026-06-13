import { BadRequestException } from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import { GameQueueService } from './game-queue.service';

describe('GameQueueService', () => {
  const service = new GameQueueService();

  function createTx() {
    return {
      gameSlot: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
  }

  it('assigns the next sort order when creating a slot', async () => {
    const tx = createTx();
    tx.gameSlot.findMany.mockResolvedValue([]);
    tx.gameSlot.findFirst.mockResolvedValue({ sortOrder: 3 });

    await expect(
      service.assignSortOrderOnCreate(tx as never, 'rule-1'),
    ).resolves.toBe(4);
  });

  it('starts queue ordering after the global max when no NEXT slots exist', async () => {
    const tx = createTx();
    tx.gameSlot.findMany.mockResolvedValue([]);
    tx.gameSlot.findFirst.mockResolvedValue({ sortOrder: 3 });

    await expect(
      service.assignSortOrderOnCreate(tx as never, 'rule-1'),
    ).resolves.toBe(4);
  });

  it('only allows the first NEXT slot to start', async () => {
    const tx = createTx();
    tx.gameSlot.findUnique.mockResolvedValue({
      status: GameStatus.NEXT,
      sortOrder: 2,
    });
    tx.gameSlot.findFirst.mockResolvedValue({ id: 'slot-1' });

    await expect(
      service.assertSlotReady(tx as never, 'slot-2'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns a finished slot to NEXT and moves it to the back', async () => {
    const tx = createTx();
    tx.gameSlot.findFirst.mockResolvedValue({ sortOrder: 5 });

    await service.moveSlotToBack(tx as never, 'slot-1');

    expect(tx.gameSlot.update).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: {
        status: GameStatus.NEXT,
        sortOrder: 6,
      },
    });
  });

  it('throws if the slot does not exist when checking readiness', async () => {
    const tx = createTx();
    tx.gameSlot.findUnique.mockResolvedValue(null);

    await expect(
      service.assertSlotReady(tx as never, 'missing-slot'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
