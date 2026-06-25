import {
  resolveWinningBallFromCalledNumbersSnapshot,
  resolveWinningBallFromEvaluation,
  resolveWinningBallRecord,
} from './winning-ball.util';

describe('winning-ball.util', () => {
  it('resolveWinningBallRecord maps number to letter', () => {
    expect(
      resolveWinningBallRecord(
        [
          { letter: 'O', number: 74 },
          { letter: 'O', number: 75 },
        ],
        74,
      ),
    ).toEqual({ letter: 'O', number: 74 });
  });

  it('resolveWinningBallFromEvaluation uses evaluation latestCalledNumber', () => {
    expect(
      resolveWinningBallFromEvaluation(
        [
          { letter: 'O', number: 74 },
          { letter: 'O', number: 75 },
        ],
        { latestCalledNumber: 74 },
      ),
    ).toEqual({ letter: 'O', number: 74 });
  });

  it('resolveWinningBallFromCalledNumbersSnapshot uses session latest ball', () => {
    expect(
      resolveWinningBallFromCalledNumbersSnapshot([
        { letter: 'I', number: 24, order: 1 },
        { letter: 'I', number: 19, order: 2 },
      ]),
    ).toEqual({ letter: 'I', number: 19 });
  });
});
