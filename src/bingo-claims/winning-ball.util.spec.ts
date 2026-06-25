import {
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
});
