import { CalledNumberRecord } from '../../called-numbers/called-numbers.select';
import { GameRuleEvaluationService } from '../game-rule-evaluation.service';
import { EvaluatorCartela } from '../interfaces/game-rule-evaluator.interface';
import { getRulePattern } from '../patterns/game-rule.patterns';
import { ComboRuleEvaluator } from './combo-rule.evaluator';

function createCartela(): EvaluatorCartela {
  return {
    id: 'cartela-1',
    number: 1,
    b: [7, 13, 10, 9, 4],
    i: [22, 20, 26, 18, 21],
    n: [37, 43, 'FREE', 41, 42],
    g: [56, 51, 57, 60, 53],
    o: [74, 64, 65, 72, 62],
  };
}

function called(numbers: number[]): CalledNumberRecord[] {
  return numbers.map((number, index) => ({
    id: `called-${number}`,
    gameSessionId: 'session-1',
    letter: 'B',
    number,
    order: index + 1,
    createdAt: new Date('2026-06-08T10:00:00.000Z'),
  }));
}

describe('ComboRuleEvaluator', () => {
  const evaluator = new ComboRuleEvaluator();
  const service = new GameRuleEvaluationService();
  const cartela = createCartela();

  const row1 = [7, 22, 37, 56, 74];
  const row2 = [13, 20, 43, 51, 64];
  const row3 = [10, 26, 57, 65];
  const row4 = [9, 18, 41, 60, 72];
  const row5 = [4, 21, 42, 53, 62];
  const colB = [7, 13, 10, 9, 4];
  const colI = [22, 20, 26, 18, 21];
  const colN = [37, 43, 41, 42];
  const colO = [74, 64, 65, 72, 62];
  const diag1 = [7, 20, 60, 62];
  const diag2 = [74, 18, 42, 51, 4];

  it('allows overlap for 2 columns + 2 rows + 1 diagonal', () => {
    const pattern = getRulePattern('MIX_01')!;
    const numbers = [...colB, ...colI, ...row1, ...row2, ...diag1];
    const result = evaluator.evaluate(cartela, called(numbers), 'MIX_01', pattern);

    expect(result.isWinner).toBe(true);
    expect(result.completedPatterns.length).toBe(5);
  });

  it('disallows overlap for 4 squares', () => {
    const pattern = getRulePattern('MIX_02')!;
    const squareR1C1 = [7, 22, 13, 20];
    const squareR1C3 = [10, 9, 43, 18];
    const squareR3C1 = [10, 26, 9, 18];
    const squareR3C3 = [41, 57, 60, 72];
    const overlappingSquares = called([
      ...squareR1C1,
      ...squareR1C3,
      ...squareR3C1,
      ...squareR3C3,
    ]);

    expect(
      evaluator.evaluate(
        cartela,
        overlappingSquares,
        'MIX_02',
        pattern,
      ).isWinner,
    ).toBe(false);

    const squareR1C4 = [56, 74, 51, 64];
    const squareR4C1 = [9, 18, 4, 21];
    const squareR4C4 = [60, 72, 53, 62];
    const validSquares = called([
      ...squareR1C1,
      ...squareR1C4,
      ...squareR4C1,
      ...squareR4C4,
    ]);

    expect(
      evaluator.evaluate(cartela, validSquares, 'MIX_02', pattern).isWinner,
    ).toBe(true);
  });

  it('disallows overlap for Big T + 2 squares', () => {
    const pattern = getRulePattern('MIX_04')!;
    const bigT = [7, 22, 37, 56, 74, 43, 41, 42];
    const squareR4C2 = [18, 42, 21, 53];
    const squareR4C3 = [41, 60, 42, 53];
    const overlapping = called([...bigT, ...squareR4C2, ...squareR4C3]);

    expect(
      evaluator.evaluate(cartela, overlapping, 'MIX_04', pattern).isWinner,
    ).toBe(false);

    const squareR4C1 = [9, 18, 4, 21];
    const squareR4C4 = [60, 72, 53, 62];
    const valid = called([...bigT, ...squareR4C1, ...squareR4C4]);

    expect(evaluator.evaluate(cartela, valid, 'MIX_04', pattern).isWinner).toBe(
      true,
    );
  });

  it('disallows overlap for 2 rows + 1 square', () => {
    const pattern = getRulePattern('MIX_08')!;
    const overlapping = called([...row1, ...row2, 7, 22, 13, 20]);

    expect(
      evaluator.evaluate(cartela, overlapping, 'MIX_08', pattern).isWinner,
    ).toBe(false);

    const squareR4C4 = [60, 72, 53, 62];
    const valid = called([...row1, ...row2, ...squareR4C4]);

    expect(evaluator.evaluate(cartela, valid, 'MIX_08', pattern).isWinner).toBe(
      true,
    );
  });

  it('requires 3 lines without FREE', () => {
    const pattern = getRulePattern('MIX_06')!;
    const withFreeLine = called([...row3, ...row1, ...row2]);
    const withoutFree = called([...row1, ...row2, ...row4]);

    expect(
      evaluator.evaluate(cartela, withFreeLine, 'MIX_06', pattern).isWinner,
    ).toBe(false);
    expect(
      evaluator.evaluate(cartela, withoutFree, 'MIX_06', pattern).isWinner,
    ).toBe(true);
  });

  it('requires 3 lines touching FREE', () => {
    const pattern = getRulePattern('MIX_12')!;
    const withoutFreeOnly = called([...row1, ...row2, ...row4]);
    const withFree = called([...row3, ...colN, ...diag1]);

    expect(
      evaluator.evaluate(cartela, withoutFreeOnly, 'MIX_12', pattern).isWinner,
    ).toBe(false);
    expect(
      evaluator.evaluate(cartela, withFree, 'MIX_12', pattern).isWinner,
    ).toBe(true);
  });

  it('requires 4 lines without diagonal', () => {
    const pattern = getRulePattern('FOUR_LINES_WITHOUT_DIAGONAL')!;
    const withDiagonal = called([...row1, ...row2, ...row3, ...row4, ...diag1]);
    const withoutDiagonal = called([...row1, ...row2, ...row3, ...row4]);

    expect(
      evaluator.evaluate(
        cartela,
        withDiagonal,
        'FOUR_LINES_WITHOUT_DIAGONAL',
        pattern,
      ).isWinner,
    ).toBe(true);
    expect(
      evaluator.evaluate(
        cartela,
        withoutDiagonal,
        'FOUR_LINES_WITHOUT_DIAGONAL',
        pattern,
      ).isWinner,
    ).toBe(true);
    expect(
      evaluator.evaluate(
        cartela,
        called([...diag1, ...diag2, ...row1, ...row2]),
        'FOUR_LINES_WITHOUT_DIAGONAL',
        pattern,
      ).isWinner,
    ).toBe(false);
  });

  it('requires 3 parallel lines without overlap', () => {
    const pattern = getRulePattern('THREE_PARALLEL_LINES')!;
    const parallelRows = called([...row1, ...row2, ...row4]);
    const mixedDirections = called([...row1, ...row2, ...colB]);

    expect(
      evaluator.evaluate(
        cartela,
        parallelRows,
        'THREE_PARALLEL_LINES',
        pattern,
      ).isWinner,
    ).toBe(true);
    expect(
      evaluator.evaluate(
        cartela,
        mixedDirections,
        'THREE_PARALLEL_LINES',
        pattern,
      ).isWinner,
    ).toBe(false);
  });

  it('requires 4 parallel lines without overlap', () => {
    const pattern = getRulePattern('FOUR_PARALLEL_LINES')!;
    const parallelRows = called([...row1, ...row2, ...row3, ...row4]);
    const mixedDirections = called([...row1, ...row2, ...row3, ...colB]);

    expect(
      evaluator.evaluate(
        cartela,
        parallelRows,
        'FOUR_PARALLEL_LINES',
        pattern,
      ).isWinner,
    ).toBe(true);
    expect(
      evaluator.evaluate(
        cartela,
        mixedDirections,
        'FOUR_PARALLEL_LINES',
        pattern,
      ).isWinner,
    ).toBe(false);
  });

  it('allows Big L + diagonal overlap', () => {
    const pattern = getRulePattern('MIX_07')!;
    const bigL = [7, 13, 10, 9, 4, 21, 42, 53, 62];
    const result = evaluator.evaluate(
      cartela,
      called([...bigL, ...diag1]),
      'MIX_07',
      pattern,
    );

    expect(result.isWinner).toBe(true);
  });

  it('allows Big cross + diagonal overlap', () => {
    const pattern = getRulePattern('BIG_CROSS_ONE_DIAGONAL')!;
    const cross = [10, 26, 57, 65, 37, 43, 41, 42];
    const result = evaluator.evaluate(
      cartela,
      called([...cross, ...diag1]),
      'BIG_CROSS_ONE_DIAGONAL',
      pattern,
    );

    expect(result.isWinner).toBe(true);
  });

  it('allows Big T + diagonal overlap', () => {
    const pattern = getRulePattern('BIG_T_ONE_DIAGONAL')!;
    const bigT = [7, 22, 37, 56, 74, 43, 41, 42];
    const result = evaluator.evaluate(
      cartela,
      called([...bigT, ...diag1]),
      'BIG_T_ONE_DIAGONAL',
      pattern,
    );

    expect(result.isWinner).toBe(true);
  });

  it('enforces mixed overlap for column + row + square', () => {
    const pattern = getRulePattern('ONE_COLUMN_ONE_ROW_ONE_SQUARE')!;
    const overlappingSquare = called([...colB, ...row1, 7, 22, 13, 20]);
    const squareR4C4 = [60, 72, 53, 62];
    const valid = called([...colB, ...row1, ...squareR4C4]);

    expect(
      evaluator.evaluate(
        cartela,
        overlappingSquare,
        'ONE_COLUMN_ONE_ROW_ONE_SQUARE',
        pattern,
      ).isWinner,
    ).toBe(false);
    expect(
      evaluator.evaluate(
        cartela,
        valid,
        'ONE_COLUMN_ONE_ROW_ONE_SQUARE',
        pattern,
      ).isWinner,
    ).toBe(true);
  });

  it('marks latest draw completion as VALID when it completes the combo', () => {
    const pattern = getRulePattern('THREE_LINES')!;
    const beforeLatest = called([...row1, ...row2]);
    const withLatest = called([...row1, ...row2, ...row4]);

    expect(
      evaluator.evaluate(cartela, beforeLatest, 'THREE_LINES', pattern)
        .isWinner,
    ).toBe(false);
    const result = evaluator.evaluate(
      cartela,
      withLatest,
      'THREE_LINES',
      pattern,
    );

    expect(result.isWinner).toBe(true);
    expect(result.latestCalledNumber).toBe(72);
    expect(result.completedByLatestNumber).toBe(true);
  });

  it('marks combo already complete before latest as INVALID_LATE_CLAIM', () => {
    const pattern = getRulePattern('THREE_LINES')!;
    const result = evaluator.evaluate(
      cartela,
      called([...row1, ...row2, ...row4, 99]),
      'THREE_LINES',
      pattern,
    );

    expect(result.isWinner).toBe(true);
    expect(result.completedByLatestNumber).toBe(false);
  });

  it('allows latest draw that completes a second valid combo', () => {
    const pattern = getRulePattern('TWO_COLUMNS_TWO_ROWS')!;
    const beforeLatest = called([...colB, ...colI, ...row1]);
    const withLatest = called([...colB, ...colI, ...row1, ...row4]);

    expect(
      evaluator.evaluate(
        cartela,
        beforeLatest,
        'TWO_COLUMNS_TWO_ROWS',
        pattern,
      ).isWinner,
    ).toBe(false);

    const result = evaluator.evaluate(
      cartela,
      withLatest,
      'TWO_COLUMNS_TWO_ROWS',
      pattern,
    );

    expect(result.isWinner).toBe(true);
    expect(result.completedByLatestNumber).toBe(true);
  });

  it('counts FREE as marked for winning combinations', () => {
    const pattern = getRulePattern('MIX_12')!;
    const row3WithFree = called([...row3, ...colN, ...diag1]);

    expect(
      evaluator.evaluate(cartela, row3WithFree, 'MIX_12', pattern).isWinner,
    ).toBe(true);
  });

  it('evaluates COMBO patterns through GameRuleEvaluationService', () => {
    const result = service.evaluate(
      cartela,
      called([...row1, ...row2, ...row4]),
      'THREE_LINES',
      getRulePattern('THREE_LINES')!,
    );

    expect(result.isWinner).toBe(true);
    expect(result.completedPatterns.length).toBe(3);
  });

  it('parses COMBO JSON from database patterns field', () => {
    const patterns = getRulePattern('MIX_02');
    const result = service.evaluate(
      cartela,
      called([
        7, 22, 13, 20, 56, 74, 51, 64, 9, 18, 4, 21, 60, 72, 53, 62,
      ]),
      'MIX_02',
      patterns!,
    );

    expect(result.isWinner).toBe(true);
  });
});
