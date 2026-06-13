import { BadRequestException } from '@nestjs/common';
import {
  assertTopFiveQueueRuleDiversity,
  QUEUE_RULE_DIVERSITY_MESSAGE,
  QUEUE_RULE_DIVERSITY_WINDOW,
  resolveInsertAfterSortOrder,
  shouldDeferDuplicateRuleInTopFive,
} from './game-queue-diversity';
import { GameQueueService } from './game-queue.service';
import { GameStatus } from '@prisma/client';

describe('game-queue-diversity', () => {
  it('detects duplicate rules in the top five window', () => {
    expect(
      shouldDeferDuplicateRuleInTopFive(
        [
          { gameRuleId: 'rule-a' },
          { gameRuleId: 'rule-b' },
          { gameRuleId: 'rule-a' },
        ],
        'rule-a',
      ),
    ).toBe(true);
  });

  it('allows duplicate rules after position five', () => {
    expect(
      shouldDeferDuplicateRuleInTopFive(
        Array.from({ length: 6 }, (_, index) => ({
          gameRuleId: index === 5 ? 'rule-a' : `rule-${index}`,
        })),
        'rule-a',
      ),
    ).toBe(false);
  });

  it('rejects reorder duplicates in the top five', () => {
    expect(() =>
      assertTopFiveQueueRuleDiversity([
        'rule-a',
        'rule-b',
        'rule-a',
        'rule-c',
        'rule-d',
      ]),
    ).toThrow(new BadRequestException(QUEUE_RULE_DIVERSITY_MESSAGE));
  });

  it('resolves insert anchor after the fifth slot when available', () => {
    const anchor = resolveInsertAfterSortOrder([
      { sortOrder: 1 },
      { sortOrder: 2 },
      { sortOrder: 3 },
      { sortOrder: 4 },
      { sortOrder: 5 },
      { sortOrder: 6 },
    ]);

    expect(anchor).toBe(5);
    expect(QUEUE_RULE_DIVERSITY_WINDOW).toBe(5);
  });
});

describe('GameQueueService queue diversity', () => {
  const service = new GameQueueService();

  function createTx(initialQueue: Array<{
    id: string;
    gameRuleId: string;
    sortOrder: number;
  }>) {
    const queue = [...initialQueue];

    return {
      gameSlot: {
        findMany: jest.fn(async ({ where, orderBy }: any) => {
          let rows = queue.filter((slot) =>
            where?.status ? slot && where.status === GameStatus.NEXT : true,
          );

          if (orderBy?.sortOrder === 'asc') {
            rows = [...rows].sort((left, right) => left.sortOrder - right.sortOrder);
          }

          return rows.map(({ id, gameRuleId, sortOrder }) => ({
            id,
            gameRuleId,
            sortOrder,
          }));
        }),
        findFirst: jest.fn(async ({ orderBy }: any) => {
          if (orderBy?.sortOrder === 'desc') {
            const sorted = [...queue].sort(
              (left, right) => right.sortOrder - left.sortOrder,
            );
            return sorted[0] ? { sortOrder: sorted[0].sortOrder } : null;
          }

          return null;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          for (const slot of queue) {
            if (
              where?.status === GameStatus.NEXT &&
              where?.sortOrder?.gt != null &&
              slot.sortOrder > where.sortOrder.gt
            ) {
              slot.sortOrder += data.sortOrder.increment;
            }
          }

          return { count: 1 };
        }),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      queue,
    };
  }

  it('places a duplicate rule after the top five on create', async () => {
    const tx = createTx([
      { id: 'slot-1', gameRuleId: 'rule-a', sortOrder: 1 },
      { id: 'slot-2', gameRuleId: 'rule-b', sortOrder: 2 },
      { id: 'slot-3', gameRuleId: 'rule-c', sortOrder: 3 },
      { id: 'slot-4', gameRuleId: 'rule-d', sortOrder: 4 },
      { id: 'slot-5', gameRuleId: 'rule-e', sortOrder: 5 },
      { id: 'slot-6', gameRuleId: 'rule-f', sortOrder: 6 },
    ]);

    const sortOrder = await service.assignSortOrderOnCreate(tx as never, 'rule-a');

    expect(sortOrder).toBe(6);
    expect(tx.gameSlot.updateMany).toHaveBeenCalled();
    expect(tx.queue.find((slot) => slot.id === 'slot-6')?.sortOrder).toBe(7);
  });

  it('allows duplicate rules when the existing duplicate is position six or later', async () => {
    const tx = createTx([
      { id: 'slot-1', gameRuleId: 'rule-b', sortOrder: 1 },
      { id: 'slot-2', gameRuleId: 'rule-c', sortOrder: 2 },
      { id: 'slot-3', gameRuleId: 'rule-d', sortOrder: 3 },
      { id: 'slot-4', gameRuleId: 'rule-e', sortOrder: 4 },
      { id: 'slot-5', gameRuleId: 'rule-f', sortOrder: 5 },
      { id: 'slot-6', gameRuleId: 'rule-a', sortOrder: 6 },
    ]);

    const sortOrder = await service.assignSortOrderOnCreate(tx as never, 'rule-a');

    expect(sortOrder).toBe(7);
    expect(tx.gameSlot.updateMany).not.toHaveBeenCalled();
  });
});
