import { Prisma } from '@prisma/client';

import {
  walletGameEntryRuleFilterSql,
  walletGameEntryRuleMatchSql,
} from './wallet-game-entry-rule-filter';

function sqlText(query: Prisma.Sql): string {
  return query.strings.join(' ');
}

describe('walletGameEntryRuleFilterSql', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const gameRuleId = '22222222-2222-4222-8222-222222222222';

  it('keeps rule ids as bound parameters', () => {
    const match = walletGameEntryRuleMatchSql(gameRuleId);
    const filter = walletGameEntryRuleFilterSql({ userId, gameRuleId });

    expect(sqlText(match)).not.toContain(gameRuleId);
    expect(sqlText(filter)).not.toContain(gameRuleId);
    expect(sqlText(filter)).not.toContain(userId);
    expect(match.values).toContain(gameRuleId);
    expect(filter.values).toContain(gameRuleId);
    expect(filter.values).toContain(userId);
  });

  it('matches a single-rule session by session rule, then slot rule', () => {
    const text = sqlText(walletGameEntryRuleMatchSql(gameRuleId));

    expect(text).toContain("slot.category::text <> 'CHAIN_GAME'");
    expect(text).toContain('COALESCE(gs."gameRuleId", slot."gameRuleId")');
  });

  it('matches a chain entry against every configured round rule', () => {
    const text = sqlText(walletGameEntryRuleMatchSql(gameRuleId));

    expect(text).toContain("slot.category::text = 'CHAIN_GAME'");
    expect(text).toContain('slot."gameRuleId"');
    expect(text).toContain('gs."gameRuleId"');
    expect(text).toContain('jsonb_array_elements_text');
    expect(text).toContain('slot."roundGameRuleIds"');
  });

  it('includes cartela charges and cancelled-game refunds', () => {
    const text = sqlText(walletGameEntryRuleFilterSql({ userId, gameRuleId }));

    expect(text).toContain("'GAME_ENTRY'");
    expect(text).toContain("'REFUND'");
    expect(text).toContain("'GAME_CARTELA'");
    expect(text).toContain("'GAME_SESSION_CANCEL'");
    expect(text).toContain(`gs.id || ':'`);
  });
});
