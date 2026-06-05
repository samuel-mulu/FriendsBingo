import { BadRequestException } from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import { GameQueueService } from './game-queue.service';

describe('GameQueueService', () => {
  const service = new GameQueueService();

  function createTx(queuedGames: Array<{ id: string; playOrder: number | null }>) {
    const games = [...queuedGames];

    return {
      game: {
        findMany: jest.fn(async () =>
          games
            .map((game) => ({ ...game }))
            .sort((left, right) => (left.playOrder ?? 999) - (right.playOrder ?? 999)),
        ),
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
          const game = games.find((item) => item.id === where.id);
          return game
            ? {
                id: game.id,
                status: GameStatus.NEXT,
                playOrder: game.playOrder,
              }
            : null;
        }),
        findFirst: jest.fn(
          async ({ where }: { where: { playOrder: number } }) => {
            const game = games.find((item) => item.playOrder === where.playOrder);
            return game ? { id: game.id } : null;
          },
        ),
        update: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string };
            data: { playOrder?: number | null };
          }) => {
            const game = games.find((item) => item.id === where.id);
            if (!game) {
              return null;
            }

            if ('playOrder' in data) {
              game.playOrder = data.playOrder ?? null;
            }

            return game;
          },
        ),
      },
    };
  }

  it('assigns the next queue position when creating a game', async () => {
    const tx = createTx([
      { id: 'game-1', playOrder: 1 },
      { id: 'game-2', playOrder: 2 },
    ]);

    await expect(service.assignPlayOrderOnCreate(tx as never)).resolves.toBe(3);
  });

  it('compacts the queue to 1..n', async () => {
    const tx = createTx([
      { id: 'game-1', playOrder: 2 },
      { id: 'game-2', playOrder: 3 },
    ]);

    await service.compactNextQueue(tx as never);

    expect(tx.game.update).toHaveBeenCalledWith({
      where: { id: 'game-1' },
      data: { playOrder: 1 },
    });
    expect(tx.game.update).toHaveBeenCalledWith({
      where: { id: 'game-2' },
      data: { playOrder: 2 },
    });
  });

  it('only allows the head game to start', async () => {
    const tx = createTx([{ id: 'game-2', playOrder: 2 }]);

    await expect(service.assertHeadNextGame(tx as never, 'game-2')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('swaps two queued games', async () => {
    const tx = createTx([
      { id: 'game-1', playOrder: 1 },
      { id: 'game-2', playOrder: 2 },
    ]);

    await service.swapQueueGames(tx as never, 'game-1', 'game-2');

    expect(tx.game.update).toHaveBeenCalledWith({
      where: { id: 'game-1' },
      data: { playOrder: 2 },
    });
    expect(tx.game.update).toHaveBeenCalledWith({
      where: { id: 'game-2' },
      data: { playOrder: 1 },
    });
  });
});
