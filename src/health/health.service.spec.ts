import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('returns degraded status when stuck sessions exist', async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      gameSession: {
        count: jest
          .fn()
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(1),
      },
    };

    const service = new HealthService(prisma as never);
    const result = await service.getHealth();

    expect(result.status).toBe('degraded');
    expect(result.stuckSessions).toEqual({
      overdueWinnerWindows: 2,
      overdueAutoCall: 1,
    });
    expect(result.schedulers).toEqual({
      autoCall: true,
      winnerWindowFinalizer: true,
    });
  });

  it('throws when database is unavailable', async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('db down')),
      gameSession: {
        count: jest.fn(),
      },
    };

    const service = new HealthService(prisma as never);

    await expect(service.getHealth()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
