import { GameRulesService } from './game-rules.service';

describe('GameRulesService', () => {
  it('lists only active game rules for admin game creation', async () => {
    const prisma = {
      gameRule: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'rule-full', key: 'FULL_HOUSE', isActive: true },
          { id: 'rule-half', key: 'HALF_HOUSE', isActive: true },
          { id: 'rule-line', key: 'LINE', isActive: true },
          { id: 'rule-columns', key: 'COLUMNS', isActive: true },
          { id: 'rule-rows', key: 'ROWS', isActive: true },
          { id: 'rule-diagonal', key: 'DIAGONAL', isActive: true },
        ]),
      },
    };

    const service = new GameRulesService(prisma as never);
    const result = await service.listActiveGameRules();

    expect(prisma.gameRule.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    expect(result.map((rule) => rule.key)).toEqual([
      'FULL_HOUSE',
      'HALF_HOUSE',
      'LINE',
      'COLUMNS',
      'ROWS',
      'DIAGONAL',
    ]);
  });
});
