import { BadRequestException } from '@nestjs/common';
import { GameStatus } from '@prisma/client';

const allowedGameStatusTransitions: Record<GameStatus, GameStatus[]> = {
  [GameStatus.NEXT]: [GameStatus.CANCELLED],
  [GameStatus.CHECKING]: [GameStatus.PLAYING, GameStatus.FINISHED, GameStatus.CANCELLED],
  [GameStatus.PLAYING]: [GameStatus.CHECKING, GameStatus.CANCELLED],
  [GameStatus.FINISHED]: [],
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
