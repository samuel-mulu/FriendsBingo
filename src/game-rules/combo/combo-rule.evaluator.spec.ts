import { CalledNumberRecord } from '../../called-numbers/called-numbers.select';
import { GameRuleEvaluationService } from '../game-rule-evaluation.service';
import { PatternRuleEvaluator } from '../evaluators/pattern-rule.evaluator';
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
    expect(result.completedPatterns.length).toBeGreaterThanOrEqual(5);
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

  it('accepts 4 corner cells with 2 disjoint non-overlapping squares', () => {
    const pattern = getRulePattern('FOUR_ANGLES_TWO_SQUARES')!;
    const sampleWin = called([
      7,
      74,
      4,
      62,
      37,
      56,
      43,
      51,
      10,
      26,
      9,
      18,
    ]);

    expect(
      evaluator.evaluate(
        cartela,
        sampleWin,
        'FOUR_ANGLES_TWO_SQUARES',
        pattern,
      ).isWinner,
    ).toBe(true);
  });

  it('rejects squares that overlap corner cells', () => {
    const pattern = getRulePattern('FOUR_ANGLES_TWO_SQUARES')!;
    const overlappingSquare = called([
      7,
      74,
      4,
      62,
      7,
      22,
      13,
      20,
      10,
      26,
      57,
      65,
    ]);

    expect(
      evaluator.evaluate(
        cartela,
        overlappingSquare,
        'FOUR_ANGLES_TWO_SQUARES',
        pattern,
      ).isWinner,
    ).toBe(false);
  });

  it('requires 2 squares for 4 corners + 2 squares', () => {
    const pattern = getRulePattern('FOUR_ANGLES_TWO_SQUARES')!;
    const cornersOnly = called([7, 74, 4, 62]);

    expect(
      evaluator.evaluate(
        cartela,
        cornersOnly,
        'FOUR_ANGLES_TWO_SQUARES',
        pattern,
      ).isWinner,
    ).toBe(false);
  });

  describe('minimum-rule and active-number validation', () => {
    it('1. FIVE_LINES with exactly 5 lines and latest in a line is valid', () => {
      const pattern = getRulePattern('MIX_05')!;
      const result = evaluator.evaluate(
        cartela,
        called([...row1, ...row2, ...row3, ...row4, ...row5]),
        'MIX_05',
        pattern,
      );

      expect(result.isWinner).toBe(true);
      expect(result.completedByLatestNumber).toBe(true);
      expect(result.latestCalledNumber).toBe(62);
    });

    it('2. FIVE_LINES with 6 lines and latest in the 6th line is valid', () => {
      const pattern = getRulePattern('MIX_05')!;
      const beforeLatest = called([...row1, ...row2, ...row3, ...row4, ...colB]);
      const withLatest = called([...row1, ...row2, ...row3, ...row4, ...colB, ...row5]);

      expect(
        evaluator.evaluate(cartela, beforeLatest, 'MIX_05', pattern).isWinner,
      ).toBe(true);
      const result = evaluator.evaluate(
        cartela,
        withLatest,
        'MIX_05',
        pattern,
      );

      expect(result.isWinner).toBe(true);
      expect(result.completedByLatestNumber).toBe(true);
      expect(result.latestCalledNumber).toBe(62);
    });

    it('3. FIVE_LINES with 8 lines and latest in any completed line is valid', () => {
      const pattern = getRulePattern('MIX_05')!;
      const numbers = [
        ...row1,
        ...row2,
        ...row3,
        ...row4,
        ...row5,
        ...colB,
        ...colI,
        ...diag1,
      ];
      const result = evaluator.evaluate(cartela, called(numbers), 'MIX_05', pattern);

      expect(result.isWinner).toBe(true);
      expect(result.completedByLatestNumber).toBe(true);
      expect(result.latestCalledNumber).toBe(62);
    });

    it('4. COLUMNS_ROWS_DIAGONAL with extra patterns and latest in a row is valid', () => {
      const pattern = getRulePattern('MIX_09')!;
      const baseNumbers = [
        ...row2,
        ...row3,
        ...row4,
        ...colB,
        ...colI,
        ...colN,
        ...diag1,
        ...diag2,
      ];
      const beforeLatest = called([...baseNumbers, ...row1.filter((number) => number !== 74)]);
      const withLatest = called([...baseNumbers, ...row1]);

      expect(
        evaluator.evaluate(cartela, beforeLatest, 'MIX_09', pattern).isWinner,
      ).toBe(true);
      const result = evaluator.evaluate(cartela, withLatest, 'MIX_09', pattern);

      expect(result.isWinner).toBe(true);
      expect(result.completedByLatestNumber).toBe(true);
      expect(result.latestCalledNumber).toBe(74);
    });

    it('5. COLUMNS_ROWS_DIAGONAL with extra patterns and latest in a column is valid', () => {
      const pattern = getRulePattern('MIX_09')!;
      const baseNumbers = [
        ...row1,
        ...row2,
        ...row3,
        ...row4,
        ...colI,
        ...colN,
        ...diag1,
        ...diag2,
      ];
      const beforeLatest = called([...baseNumbers, ...colB.filter((number) => number !== 4)]);
      const withLatest = called([...baseNumbers, ...colB]);

      expect(
        evaluator.evaluate(cartela, beforeLatest, 'MIX_09', pattern).isWinner,
      ).toBe(true);
      const result = evaluator.evaluate(cartela, withLatest, 'MIX_09', pattern);

      expect(result.isWinner).toBe(true);
      expect(result.completedByLatestNumber).toBe(true);
      expect(result.latestCalledNumber).toBe(4);
    });

    it('6. COLUMNS_ROWS_DIAGONAL with extra patterns and latest in a diagonal is valid', () => {
      const pattern = getRulePattern('MIX_09')!;
      const baseNumbers = [
        ...row1,
        ...row2,
        ...row3,
        ...row4,
        ...colB,
        ...colI,
        ...colN,
        ...diag2,
      ];
      const beforeLatest = called([...baseNumbers, 7, 20]);
      const withLatest = called([...baseNumbers, 7, 20, 60]);

      expect(
        evaluator.evaluate(cartela, beforeLatest, 'MIX_09', pattern).isWinner,
      ).toBe(true);
      const result = evaluator.evaluate(cartela, withLatest, 'MIX_09', pattern);

      expect(result.isWinner).toBe(true);
      expect(result.completedByLatestNumber).toBe(true);
      expect(result.latestCalledNumber).toBe(60);
    });

    it('7. rejects when minimum is satisfied but latest is not in any completed relevant pattern', () => {
      const pattern = getRulePattern('MIX_05')!;
      const result = evaluator.evaluate(
        cartela,
        called([...row1, ...row2, ...row3, ...row4, ...row5, 99]),
        'MIX_05',
        pattern,
      );

      expect(result.isWinner).toBe(true);
      expect(result.completedByLatestNumber).toBe(false);
    });

    it('8. rejects when minimum rule is not satisfied', () => {
      const pattern = getRulePattern('MIX_05')!;
      const result = evaluator.evaluate(
        cartela,
        called([...row1, ...row2, ...row3, ...row4]),
        'MIX_05',
        pattern,
      );

      expect(result.isWinner).toBe(false);
      expect(result.completedByLatestNumber).toBe(false);
    });

    it('9. keeps simple ROWS latest-ball behavior unchanged', () => {
      const patternRuleEvaluator = new PatternRuleEvaluator();
      const pattern = getRulePattern('ROWS')!;
      const onTime = patternRuleEvaluator.evaluate(
        cartela,
        called([7, 22, 37, 56, 74]),
        'ROWS',
        pattern,
      );
      const late = patternRuleEvaluator.evaluate(
        cartela,
        called([7, 22, 37, 56, 74, 75]),
        'ROWS',
        pattern,
      );

      expect(onTime.completedByLatestNumber).toBe(true);
      expect(late.isWinner).toBe(true);
      expect(late.completedByLatestNumber).toBe(false);
    });
  });

  describe('combination selection with latest called number', () => {
    it('accepts FOUR_LINES when latest completes a valid 4-line combo among extra lines', () => {
      const pattern = getRulePattern('FOUR_LINES')!;
      const beforeLatest = called([...row1, ...row2, ...row3]);
      const withLatest = called([...row1, ...row2, ...row3, ...row5]);

      expect(
        evaluator.evaluate(cartela, beforeLatest, 'FOUR_LINES', pattern)
          .isWinner,
      ).toBe(false);

      const result = evaluator.evaluate(
        cartela,
        withLatest,
        'FOUR_LINES',
        pattern,
      );

      expect(result.isWinner).toBe(true);
      expect(result.completedByLatestNumber).toBe(true);
      expect(result.latestCalledNumber).toBe(62);
      expect(
        result.completedPatterns.some((pattern) =>
          pattern.numbers.includes(62),
        ),
      ).toBe(true);
    });

    it('accepts FOUR_LINES when latest is in any completed line even if minimum was already met', () => {
      const pattern = getRulePattern('FOUR_LINES')!;
      const result = evaluator.evaluate(
        cartela,
        called([...row1, ...row2, ...row3, ...row4, ...row5]),
        'FOUR_LINES',
        pattern,
      );

      expect(result.isWinner).toBe(true);
      expect(result.completedByLatestNumber).toBe(true);
      expect(result.latestCalledNumber).toBe(62);
    });

    it('accepts MIX_09 when latest completes a valid diagonal despite extra completed lines', () => {
      const pattern = getRulePattern('MIX_09')!;
      const beforeLatest = called([...colN, ...row3]);
      const withLatest = called([...colN, ...row3, ...diag1]);

      expect(
        evaluator.evaluate(cartela, beforeLatest, 'MIX_09', pattern).isWinner,
      ).toBe(false);

      const result = evaluator.evaluate(
        cartela,
        withLatest,
        'MIX_09',
        pattern,
      );

      expect(result.isWinner).toBe(true);
      expect(result.completedByLatestNumber).toBe(true);
      expect(result.latestCalledNumber).toBe(62);
      expect(
        result.completedPatterns.some((pattern) => pattern.key.startsWith('DIAG')),
      ).toBe(true);
    });

    it('accepts MIX_12 when latest completes a third free-touching line among extra lines', () => {
      const pattern = getRulePattern('MIX_12')!;
      const beforeLatest = called([...row3, ...colN, ...row4]);
      const withLatest = called([...row3, ...colN, ...row4, ...diag1]);

      expect(
        evaluator.evaluate(cartela, beforeLatest, 'MIX_12', pattern).isWinner,
      ).toBe(false);

      const result = evaluator.evaluate(
        cartela,
        withLatest,
        'MIX_12',
        pattern,
      );

      expect(result.isWinner).toBe(true);
      expect(result.completedByLatestNumber).toBe(true);
    });

    it('accepts MIX_12 when latest is in any completed free-touching line', () => {
      const pattern = getRulePattern('MIX_12')!;
      const result = evaluator.evaluate(
        cartela,
        called([...row3, ...colN, ...diag1, ...diag2]),
        'MIX_12',
        pattern,
      );

      expect(result.isWinner).toBe(true);
      expect(result.completedByLatestNumber).toBe(true);
    });

    it('keeps simple ROWS latest-ball behavior unchanged', () => {
      const patternRuleEvaluator = new PatternRuleEvaluator();
      const pattern = getRulePattern('ROWS')!;
      const onTime = patternRuleEvaluator.evaluate(
        cartela,
        called([7, 22, 37, 56, 74]),
        'ROWS',
        pattern,
      );
      const late = patternRuleEvaluator.evaluate(
        cartela,
        called([7, 22, 37, 56, 74, 75]),
        'ROWS',
        pattern,
      );

      expect(onTime.completedByLatestNumber).toBe(true);
      expect(late.isWinner).toBe(true);
      expect(late.completedByLatestNumber).toBe(false);
    });

    it('does not mark invalid combo patterns as winners', () => {
      const pattern = getRulePattern('MIX_02')!;
      const invalid = evaluator.evaluate(
        cartela,
        called([7, 22, 13, 20, 10, 9, 43, 18, 10, 26, 9, 18, 41, 57, 60, 72]),
        'MIX_02',
        pattern,
      );

      expect(invalid.isWinner).toBe(false);
      expect(invalid.completedByLatestNumber).toBe(false);
    });
  });
});
