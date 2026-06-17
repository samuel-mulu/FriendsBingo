import { GameCartelaStatus } from '@prisma/client';
import { buildSessionOutcomeSummary } from './session-outcome-summary.builder';

describe('buildSessionOutcomeSummary', () => {
  it('returns sorted winner and blocked cartela numbers', async () => {
    const prisma = {
      gameCartela: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { cartela: { number: 233 } },
            { cartela: { number: 15 } },
          ])
          .mockResolvedValueOnce([
            { cartela: { number: 44 } },
            { cartela: { number: 3 } },
          ]),
      },
    };

    const summary = await buildSessionOutcomeSummary(
      prisma as never,
      'session-1',
    );

    expect(summary.winnerCartelaNumbers).toEqual([15, 233]);
    expect(summary.blockedCartelaNumbers).toEqual([3, 44]);
    expect(prisma.gameCartela.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        gameSessionId: 'session-1',
        isWinner: true,
        status: GameCartelaStatus.WINNER,
      },
      select: {
        cartela: {
          select: { number: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  });
});
