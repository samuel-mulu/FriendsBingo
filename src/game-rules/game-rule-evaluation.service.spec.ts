import { GameRuleEvaluationService } from './game-rule-evaluation.service';

describe('GameRuleEvaluationService', () => {
  const service = new GameRuleEvaluationService();

  const cartela = {
    id: 'cartela-1',
    number: 1,
    b: [7, 13, 10, 9, 4],
    i: [22, 20, 26, 18, 21],
    n: [37, 43, 'FREE', 41, 42],
    g: [56, 51, 57, 60, 53],
    o: [74, 64, 65, 72, 62],
  };

  it('bypasses manual rules at the service boundary', () => {
    expect(service.isManualRule('MANUAL')).toBe(true);
    expect(service.isManualRule('manual')).toBe(true);
    expect(service.isManualRule('HALF_HOUSE')).toBe(false);
  });

  it('dispatches by rule key', () => {
    const result = service.evaluate(
      cartela,
      [7, 22, 37, 56, 74].map((number, index) => ({
        id: `called-${number}`,
        gameSessionId: 'session-1',
        letter: 'B',
        number,
        order: index + 1,
        createdAt: new Date(),
      })),
      'ROWS',
    );

    expect(result.isWinner).toBe(true);
    expect(result.matchedPattern).toContain('ROWS');
  });

  it('returns unsupported for unknown rules', () => {
    const result = service.evaluate(cartela, [], 'MIX_01');
    expect(result.isWinner).toBe(false);
    expect(result.matchedPattern).toBe('MIX_01:UNSUPPORTED');
  });
});
