import {
  FINAL_PRODUCT_RULE_KEYS,
  PRODUCT_RULE_KEYS,
  RULE_PATTERN_DEFINITIONS,
} from './patterns/game-rule.patterns';
import {
  LEGACY_GAME_RULE_KEYS,
  seededGameRules,
} from './game-rule.seed-data';

const REMOVED_DUPLICATE_KEYS = [
  'FIVE_LINES',
  'SEVEN_LINES',
  'BIG_L_ONE_DIAGONAL',
] as const;

describe('seededGameRules', () => {
  it('seeds exactly 35 active product rules', () => {
    expect(seededGameRules).toHaveLength(35);
    expect(PRODUCT_RULE_KEYS).toHaveLength(35);
    expect(FINAL_PRODUCT_RULE_KEYS).toEqual(PRODUCT_RULE_KEYS);
    expect(seededGameRules.every((rule) => rule.isActive)).toBe(true);
    expect(seededGameRules.map((rule) => rule.key)).toEqual([
      ...PRODUCT_RULE_KEYS,
    ]);
  });

  it('gives every active rule non-null patterns', () => {
    for (const rule of seededGameRules) {
      expect(rule.patterns).toBeDefined();
      expect(rule.patterns).not.toBeNull();
    }
  });

  it('does not expose MIX_* keys in display names', () => {
    for (const rule of seededGameRules) {
      expect(rule.name).not.toMatch(/^MIX_/i);
      expect(rule.name).not.toMatch(/^mix_/);
    }
  });

  it('matches TWO_ROWS_ONE_SQUARE_ALT pattern to MIX_08', () => {
    const mix08 = seededGameRules.find((rule) => rule.key === 'MIX_08');
    const alt = seededGameRules.find(
      (rule) => rule.key === 'TWO_ROWS_ONE_SQUARE_ALT',
    );

    expect(mix08?.patterns).toEqual(alt?.patterns);
    expect(mix08?.patterns).toEqual(
      RULE_PATTERN_DEFINITIONS.TWO_ROWS_ONE_SQUARE_ALT,
    );
    expect(alt).toEqual(
      expect.objectContaining({
        name: '2 Rows + 1 Square',
        description: 'Complete 2 rows and 1 square. Overlap not allowed.',
        isActive: true,
      }),
    );
  });

  it('activates half-house rules with correct display names', () => {
    expect(
      seededGameRules.find((rule) => rule.key === 'HALF_HOUSE_10_DIRECTIONS'),
    ).toEqual(
      expect.objectContaining({
        isActive: true,
        name: 'Half House',
      }),
    );
    expect(
      seededGameRules.find((rule) => rule.key === 'HALF_HOUSE_4_DIRECTIONS'),
    ).toEqual(
      expect.objectContaining({
        isActive: true,
        name: 'Half House 4 Directions',
      }),
    );
  });

  it('does not seed legacy HALF_HOUSE or removed placeholder keys', () => {
    const seededKeys = new Set(seededGameRules.map((rule) => rule.key));

    expect(seededKeys.has('HALF_HOUSE')).toBe(false);
    for (const key of LEGACY_GAME_RULE_KEYS) {
      expect(seededKeys.has(key)).toBe(false);
    }
  });

  it('does not seed duplicate inactive product keys', () => {
    const seededKeys = new Set(seededGameRules.map((rule) => rule.key));

    for (const key of REMOVED_DUPLICATE_KEYS) {
      expect(seededKeys.has(key)).toBe(false);
    }
  });

  it('allows duplicate display name only for product #9 and #25', () => {
    const duplicateNameRules = seededGameRules.filter(
      (rule) => rule.name === '2 Rows + 1 Square',
    );

    expect(duplicateNameRules.map((rule) => rule.key).sort()).toEqual(
      ['MIX_08', 'TWO_ROWS_ONE_SQUARE_ALT'].sort(),
    );

    const activeNames = seededGameRules.map((rule) => rule.name);
    const duplicateNames = activeNames.filter(
      (name, index) => activeNames.indexOf(name) !== index,
    );

    expect(new Set(duplicateNames)).toEqual(new Set(['2 Rows + 1 Square']));
  });

  it('has exactly one active rule named Half House', () => {
    const halfHouseNamed = seededGameRules.filter(
      (rule) => rule.name === 'Half House',
    );

    expect(halfHouseNamed).toHaveLength(1);
    expect(halfHouseNamed[0]?.key).toBe('HALF_HOUSE_10_DIRECTIONS');
  });

  it('seeds pattern JSON for representative rules', () => {
    expect(
      seededGameRules.find((rule) => rule.key === 'FULL_HOUSE')?.patterns,
    ).toEqual({ type: 'FULL_HOUSE' });
    expect(
      seededGameRules.find((rule) => rule.key === 'MIX_01')?.patterns,
    ).toEqual(
      expect.objectContaining({
        type: 'COMBO',
        overlap: 'ALLOW',
      }),
    );
    expect(seededGameRules.find((rule) => rule.key === 'MIX_01')?.name).toBe(
      '2 Col + 2 Row + 1 Diag',
    );
  });
});
