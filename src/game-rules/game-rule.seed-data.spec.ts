import { seededGameRules } from './game-rule.seed-data';

describe('seededGameRules', () => {
  it('activates the first automatic rule set for production play', () => {
    const activeRules = seededGameRules.filter((rule) => rule.isActive);

    expect(activeRules.map((rule) => rule.key)).toEqual([
      'FULL_HOUSE',
      'HALF_HOUSE',
      'LINE',
      'COLUMNS',
      'ROWS',
      'DIAGONAL',
    ]);
  });

  it('seeds pattern JSON for automatic and shape rules', () => {
    expect(
      seededGameRules.find((rule) => rule.key === 'FULL_HOUSE')?.patterns,
    ).toEqual({ type: 'FULL_HOUSE' });
    expect(
      seededGameRules.find((rule) => rule.key === 'HALF_HOUSE')?.patterns,
    ).toEqual({ type: 'ROWS_REQUIRED', count: 3 });
    expect(
      seededGameRules.find((rule) => rule.key === 'BIG_T')?.patterns,
    ).toEqual(
      expect.objectContaining({
        type: 'PATTERN_GROUP',
      }),
    );
    expect(seededGameRules.find((rule) => rule.key === 'MIX_01')?.patterns).toBe(
      undefined,
    );
  });

  it('keeps MANUAL seeded but inactive as fallback', () => {
    const manualRule = seededGameRules.find((rule) => rule.key === 'MANUAL');

    expect(manualRule).toBeDefined();
    expect(manualRule?.isActive).toBe(false);
    expect(manualRule?.sortOrder).toBe(1);
  });
});
