import { BadRequestException } from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import {
  assertValidGameStatusTransition,
  canTransitionGameStatus,
} from './game-status.rules';

describe('game status rules', () => {
  it('allows valid transitions', () => {
    expect(
      canTransitionGameStatus(GameStatus.NEXT, GameStatus.PLAYING),
    ).toBe(true);
    expect(
      canTransitionGameStatus(GameStatus.PLAYING, GameStatus.CHECKING),
    ).toBe(true);
    expect(
      canTransitionGameStatus(GameStatus.CHECKING, GameStatus.FINISHED),
    ).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(() =>
      assertValidGameStatusTransition(GameStatus.NEXT, GameStatus.CHECKING),
    ).toThrow(BadRequestException);

    expect(() =>
      assertValidGameStatusTransition(GameStatus.PLAYING, GameStatus.FINISHED),
    ).toThrow(BadRequestException);

    expect(() =>
      assertValidGameStatusTransition(
        GameStatus.FINISHED,
        GameStatus.CANCELLED,
      ),
    ).toThrow(BadRequestException);
  });
});
