import { Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  countOperationsSummaryItems,
  RequestPerformanceContext,
  resolvePerformanceRole,
} from './request-performance.context';

describe('RequestPerformanceContext', () => {
  it('records nested prisma queries and logs completion metrics', async () => {
    const context = new RequestPerformanceContext();
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    const result = await context.run(
      { operation: 'testOperation', userRole: UserRole.PLAYER },
      async () => {
        context.recordQuery({
          model: 'GameSession',
          operation: 'findMany',
          durationMs: 12,
        });
        context.recordQuery({
          model: 'GameCartela',
          operation: 'findMany',
          durationMs: 45,
        });

        return { value: 'ok' };
      },
      () => ({ cartelaCount: 2 }),
    );

    expect(result).toEqual({ value: 'ok' });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('testOperation'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('queryCount=2'),
    );
    expect(logSpy.mock.calls[0]?.[0]).toContain(
      'slowestQuery=GameCartela.findMany',
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('cartelaCount=2'),
    );

    logSpy.mockRestore();
  });
});

describe('resolvePerformanceRole', () => {
  it('returns guest when user id is missing', () => {
    expect(resolvePerformanceRole()).toBe('guest');
  });

  it('defaults authenticated callers to player', () => {
    expect(resolvePerformanceRole('user-1')).toBe(UserRole.PLAYER);
  });
});

describe('countOperationsSummaryItems', () => {
  it('sums summary counts from live and registration games only', () => {
    expect(
      countOperationsSummaryItems({
        liveGame: { registeredCartelasSummary: [{}, {}] },
        registrationOpenGame: { registeredCartelasSummary: [{}] },
      }),
    ).toBe(3);
  });
});
