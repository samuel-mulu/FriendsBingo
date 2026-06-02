import { BadRequestException } from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import {
  assertValidGameStatusTransition,
  canTransitionGameStatus,
} from './game-status.rules';

describe('game status rules', () => {
  it('allows valid transitions', () => {
    expect(
      canTransitionGameStatus(GameStatus.NEXT, GameStatus.CHECKING),
    ).toBe(true);
    expect(
      canTransitionGameStatus(GameStatus.CHECKING, GameStatus.PLAYING),
    ).toBe(true);
    expect(
      canTransitionGameStatus(GameStatus.PLAYING, GameStatus.FINISHED),
    ).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(() =>
      assertValidGameStatusTransition(GameStatus.NEXT, GameStatus.PLAYING),
    ).toThrow(BadRequestException);

    expect(() =>
      assertValidGameStatusTransition(
        GameStatus.FINISHED,
        GameStatus.CANCELLED,
      ),
    ).toThrow(BadRequestException);
  });
});
