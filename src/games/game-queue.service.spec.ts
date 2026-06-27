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
      category: 'NORMAL',
    });
    tx.gameSlot.findMany.mockResolvedValue([
      { id: 'slot-1', category: 'NORMAL', sortOrder: 1 },
      { id: 'slot-2', category: 'NORMAL', sortOrder: 2 },
    ]);

    await expect(
      service.assertSlotReady(tx as never, 'slot-2'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a READY session to start when empty NEXT slots are ahead in the queue', async () => {
    const tx = createTx();
    tx.gameSlot.findUnique.mockResolvedValue({
      status: GameStatus.NEXT,
      sortOrder: 2,
      category: 'NORMAL',
      sessions: [{ scheduledStartAt: new Date(Date.now() - 1_000) }],
    });
    tx.gameSlot.findMany.mockResolvedValue([
      {
        id: 'slot-1',
        status: GameStatus.NEXT,
        category: 'NORMAL',
        sortOrder: 1,
        sessions: [],
      },
      {
        id: 'slot-2',
        status: GameStatus.NEXT,
        category: 'NORMAL',
        sortOrder: 2,
        sessions: [{ scheduledStartAt: new Date(Date.now() - 1_000) }],
      },
    ]);

    await expect(
      service.assertSlotReady(tx as never, 'slot-2'),
    ).resolves.toBeUndefined();
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

  it('prioritizes bonus slots ahead of normal queue slots', async () => {
    const tx = createTx();
    tx.gameSlot.findUnique.mockResolvedValue({
      status: GameStatus.NEXT,
      sortOrder: 3,
      category: 'NORMAL',
    });
    tx.gameSlot.findMany.mockResolvedValue([
      { id: 'slot-bonus', category: 'BONUS', sortOrder: 9 },
      { id: 'slot-normal', category: 'NORMAL', sortOrder: 3 },
    ]);

    await expect(
      service.assertSlotReady(tx as never, 'slot-normal'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('removes bonus slots after session completion when configured', async () => {
    const tx = createTx();
    tx.gameSlot.findUnique.mockResolvedValue({ removeAfterFinish: true });

    await expect(
      service.restoreSlotAfterSession(tx as never, 'slot-bonus'),
    ).resolves.toBe('removed');

    expect(tx.gameSlot.update).toHaveBeenCalledWith({
      where: { id: 'slot-bonus' },
      data: { status: GameStatus.CANCELLED },
    });
  });

  it('blocks a normal slot when a due Big Game is waiting to start', async () => {
    const tx = createTx();
    tx.gameSlot.findUnique.mockResolvedValue({
      status: GameStatus.NEXT,
      sortOrder: 1,
      category: 'NORMAL',
      sessions: [],
    });
    tx.gameSlot.findMany.mockResolvedValue([
      {
        id: 'slot-normal',
        status: GameStatus.NEXT,
        category: 'NORMAL',
        sortOrder: 1,
        sessions: [],
      },
      {
        id: 'slot-big',
        status: GameStatus.NEXT,
        category: 'BIG_GAME',
        sortOrder: 9,
        sessions: [
          {
            scheduledStartAt: new Date(Date.now() - 1_000),
          },
        ],
      },
    ]);

    await expect(
      service.assertSlotReady(tx as never, 'slot-normal'),
    ).rejects.toThrow('due Big Game');
  });

  it('allows the due Big Game slot to start before lower-priority queue slots', async () => {
    const tx = createTx();
    tx.gameSlot.findUnique.mockResolvedValue({
      status: GameStatus.NEXT,
      sortOrder: 9,
      category: 'BIG_GAME',
      sessions: [
        {
          scheduledStartAt: new Date(Date.now() - 1_000),
        },
      ],
    });
    tx.gameSlot.findMany.mockResolvedValue([
      {
        id: 'slot-normal',
        status: GameStatus.NEXT,
        category: 'NORMAL',
        sortOrder: 1,
        sessions: [],
      },
      {
        id: 'slot-big',
        status: GameStatus.NEXT,
        category: 'BIG_GAME',
        sortOrder: 9,
        sessions: [
          {
            scheduledStartAt: new Date(Date.now() - 1_000),
          },
        ],
      },
    ]);

    await expect(
      service.assertSlotReady(tx as never, 'slot-big'),
    ).resolves.toBeUndefined();
  });

  it('does not let a future Big Game block normal queue starts', async () => {
    const tx = createTx();
    tx.gameSlot.findUnique.mockResolvedValue({
      status: GameStatus.NEXT,
      sortOrder: 2,
      category: 'NORMAL',
      sessions: [],
    });
    tx.gameSlot.findMany.mockResolvedValue([
      {
        id: 'slot-big',
        status: GameStatus.NEXT,
        category: 'BIG_GAME',
        sortOrder: 1,
        sessions: [
          {
            scheduledStartAt: new Date(Date.now() + 60_000),
          },
        ],
      },
      {
        id: 'slot-normal',
        status: GameStatus.NEXT,
        category: 'NORMAL',
        sortOrder: 2,
        sessions: [],
      },
    ]);

    await expect(
      service.assertSlotReady(tx as never, 'slot-normal'),
    ).resolves.toBeUndefined();
  });

  it('does not let a future Big Game start early', async () => {
    const tx = createTx();
    tx.gameSlot.findUnique.mockResolvedValue({
      status: GameStatus.NEXT,
      sortOrder: 1,
      category: 'BIG_GAME',
      sessions: [
        {
          scheduledStartAt: new Date(Date.now() + 60_000),
        },
      ],
    });
    tx.gameSlot.findMany.mockResolvedValue([
      {
        id: 'slot-big',
        status: GameStatus.NEXT,
        category: 'BIG_GAME',
        sortOrder: 1,
        sessions: [
          {
            scheduledStartAt: new Date(Date.now() + 60_000),
          },
        ],
      },
    ]);

    await expect(
      service.assertSlotReady(tx as never, 'slot-big'),
    ).rejects.toThrow('scheduled start time');
  });
});
