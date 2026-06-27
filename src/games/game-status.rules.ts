import { BadRequestException } from '@nestjs/common';
import { GameStatus } from '@prisma/client';

const allowedGameStatusTransitions: Record<GameStatus, GameStatus[]> = {
  [GameStatus.NEXT]: [GameStatus.READY, GameStatus.CANCELLED],
  [GameStatus.READY]: [GameStatus.PLAYING, GameStatus.CANCELLED],
  [GameStatus.CHECKING]: [
    GameStatus.PLAYING,
    GameStatus.FINISHED,
    GameStatus.NO_WINNER,
    GameStatus.CANCELLED,
  ],
  [GameStatus.PLAYING]: [
    GameStatus.CHECKING,
    GameStatus.WINNER_WINDOW,
    GameStatus.NO_WINNER,
    GameStatus.CANCELLED,
  ],
  [GameStatus.WINNER_WINDOW]: [GameStatus.FINISHED, GameStatus.CANCELLED],
  [GameStatus.FINISHED]: [],
  [GameStatus.NO_WINNER]: [],
  [GameStatus.CANCELLED]: [],
};

export function canTransitionGameStatus(
  from: GameStatus,
  to: GameStatus,
): boolean {
  return allowedGameStatusTransitions[from].includes(to);
}

export function assertValidGameStatusTransition(
  currentStatus: GameStatus,
  nextStatus: GameStatus,
): void {
  if (!canTransitionGameStatus(currentStatus, nextStatus)) {
    throw new BadRequestException(
      `Invalid game status transition from ${currentStatus} to ${nextStatus}`,
    );
  }
}
