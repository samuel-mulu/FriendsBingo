import { BadRequestException, Injectable } from '@nestjs/common';
import { GameStatus, Prisma } from '@prisma/client';

type QueueDbClient = Prisma.TransactionClient;

@Injectable()
export class GameQueueService {
  async assignPlayOrderOnCreate(
    tx: QueueDbClient,
    requestedOrder?: number,
  ): Promise<number> {
    const queuedGames = await this.listQueuedGames(tx);

    if (requestedOrder === undefined) {
      return queuedGames.length + 1;
    }

    const nextPosition = Math.min(
      Math.max(1, requestedOrder),
      queuedGames.length + 1,
    );

    for (const game of queuedGames) {
      const currentOrder = game.playOrder ?? Number.MAX_SAFE_INTEGER;
      if (currentOrder >= nextPosition) {
        await tx.game.update({
          where: { id: game.id },
          data: { playOrder: currentOrder + 1 },
        });
      }
    }

    return nextPosition;
  }

  async assertHeadNextGame(tx: QueueDbClient, gameId: string): Promise<void> {
    const game = await tx.game.findUnique({
      where: { id: gameId },
      select: {
        status: true,
        playOrder: true,
      },
    });

    if (!game) {
      throw new BadRequestException('Game not found');
    }

    if (game.status !== GameStatus.NEXT) {
      throw new BadRequestException('Only NEXT games can be started');
    }

    if (game.playOrder !== 1) {
      throw new BadRequestException(
        'Only the first game in the queue (order 1) can be started',
      );
    }
  }

  async compactNextQueue(tx: QueueDbClient): Promise<void> {
    const queuedGames = await this.listQueuedGames(tx);

    for (let index = 0; index < queuedGames.length; index += 1) {
      const nextOrder = index + 1;
      const game = queuedGames[index];

      if (game.playOrder !== nextOrder) {
        await tx.game.update({
          where: { id: game.id },
          data: { playOrder: nextOrder },
        });
      }
    }
  }

  async swapQueueGames(
    tx: QueueDbClient,
    gameIdA: string,
    gameIdB: string,
  ): Promise<void> {
    const [gameA, gameB] = await Promise.all([
      tx.game.findUnique({
        where: { id: gameIdA },
        select: { status: true, playOrder: true },
      }),
      tx.game.findUnique({
        where: { id: gameIdB },
        select: { status: true, playOrder: true },
      }),
    ]);

    if (!gameA || !gameB) {
      throw new BadRequestException('Game not found');
    }

    if (gameA.status !== GameStatus.NEXT || gameB.status !== GameStatus.NEXT) {
      throw new BadRequestException('Only NEXT games can be reordered');
    }

    if (gameA.playOrder == null || gameB.playOrder == null) {
      throw new BadRequestException('Both games must be in the active queue');
    }

    await tx.game.update({
      where: { id: gameIdA },
      data: { playOrder: gameB.playOrder },
    });
    await tx.game.update({
      where: { id: gameIdB },
      data: { playOrder: gameA.playOrder },
    });
  }

  async moveQueueGame(
    tx: QueueDbClient,
    gameId: string,
    direction: 'up' | 'down',
  ): Promise<void> {
    const game = await tx.game.findUnique({
      where: { id: gameId },
      select: { status: true, playOrder: true },
    });

    if (!game) {
      throw new BadRequestException('Game not found');
    }

    if (game.status !== GameStatus.NEXT || game.playOrder == null) {
      throw new BadRequestException('Only queued NEXT games can be moved');
    }

    const targetOrder =
      direction === 'up' ? game.playOrder - 1 : game.playOrder + 1;

    if (targetOrder < 1) {
      throw new BadRequestException('This game is already first in the queue');
    }

    const neighbor = await tx.game.findFirst({
      where: {
        status: GameStatus.NEXT,
        playOrder: targetOrder,
      },
      select: { id: true },
    });

    if (!neighbor) {
      throw new BadRequestException('This game is already last in the queue');
    }

    await this.swapQueueGames(tx, gameId, neighbor.id);
  }

  private async listQueuedGames(tx: QueueDbClient) {
    return tx.game.findMany({
      where: { status: GameStatus.NEXT },
      select: {
        id: true,
        playOrder: true,
      },
      orderBy: [{ playOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }
}
