import {
  parseRoundGameRuleIds,
  resolveRoundGameRuleId,
  resolveSessionGameRule,
  resolveSessionGameRuleKey,
} from './round-game-rule.util';

describe('round-game-rule.util', () => {
  describe('parseRoundGameRuleIds', () => {
    it('returns empty for missing values', () => {
      expect(parseRoundGameRuleIds(null)).toEqual([]);
      expect(parseRoundGameRuleIds(undefined)).toEqual([]);
      expect(parseRoundGameRuleIds([])).toEqual([]);
    });

    it('parses string ids', () => {
      expect(parseRoundGameRuleIds(['a', 'b'])).toEqual(['a', 'b']);
    });
  });

  describe('resolveRoundGameRuleId', () => {
    it('picks the rule for the round index', () => {
      expect(
        resolveRoundGameRuleId({
          roundIndex: 1,
          roundGameRuleIds: ['rule-1', 'rule-2'],
          fallbackGameRuleId: 'fallback',
        }),
      ).toBe('rule-1');

      expect(
        resolveRoundGameRuleId({
          roundIndex: 2,
          roundGameRuleIds: ['rule-1', 'rule-2'],
          fallbackGameRuleId: 'fallback',
        }),
      ).toBe('rule-2');
    });

    it('falls back when roundGameRuleIds is missing', () => {
      expect(
        resolveRoundGameRuleId({
          roundIndex: 2,
          roundGameRuleIds: null,
          fallbackGameRuleId: 'fallback',
        }),
      ).toBe('fallback');
    });
  });

  describe('resolveSessionGameRule', () => {
    it('prefers session rule over slot rule', () => {
      expect(
        resolveSessionGameRule({
          sessionGameRule: { id: 's', key: 'HALF', name: 'Half' },
          slotGameRule: { id: 'l', key: 'FULL', name: 'Full' },
        }),
      ).toEqual({ id: 's', key: 'HALF', name: 'Half' });
    });

    it('falls back to slot rule', () => {
      expect(
        resolveSessionGameRule({
          sessionGameRule: null,
          slotGameRule: { id: 'l', key: 'FULL', name: 'Full' },
        }),
      ).toEqual({ id: 'l', key: 'FULL', name: 'Full' });
    });
  });

  describe('resolveSessionGameRuleKey', () => {
    it('prefers session key then slot key then gameType', () => {
      expect(
        resolveSessionGameRuleKey({
          sessionGameRuleKey: 'HALF',
          slotGameRuleKey: 'FULL',
          slotGameType: 'MANUAL',
        }),
      ).toBe('HALF');

      expect(
        resolveSessionGameRuleKey({
          sessionGameRuleKey: null,
          slotGameRuleKey: 'FULL',
          slotGameType: 'MANUAL',
        }),
      ).toBe('FULL');

      expect(
        resolveSessionGameRuleKey({
          sessionGameRuleKey: null,
          slotGameRuleKey: null,
          slotGameType: 'MANUAL',
        }),
      ).toBe('MANUAL');
    });
  });
});
