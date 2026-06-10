import { GameStatus } from '@prisma/client';
import { HealthService } from './health.service';

describe('HealthService scheduledStartAt monitoring', () => {
  it('flags overdue READY sessions past scheduledStartAt grace', async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      gameSession: {
        count: jest
          .fn()
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(1),
      },
    };

    const service = new HealthService(prisma as never);
    const result = await service.getHealth();

    expect(result.status).toBe('degraded');
    expect(result.stuckSessions.overdueScheduledStart).toBe(1);
    expect(prisma.gameSession.count).toHaveBeenNthCalledWith(3, {
      where: {
        status: GameStatus.READY,
        scheduledStartAt: { lte: expect.any(Date) },
      },
    });
  });
});
