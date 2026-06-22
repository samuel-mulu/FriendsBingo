import { RefreshTokenService } from './refresh-token.service';

describe('RefreshTokenService', () => {
  it('defaults refresh token lifetime to 90 days', async () => {
    const prisma = {
      refreshToken: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };

    const service = new RefreshTokenService(
      prisma as never,
      {
        get: jest.fn().mockReturnValue(undefined),
      } as never,
    );

    const before = Date.now();
    const result = await service.createRefreshToken('user-1', 'device-1');
    const after = Date.now();
    const expectedMs = 90 * 24 * 60 * 60 * 1000;

    expect(
      result.expiresAt.getTime() - before,
    ).toBeGreaterThanOrEqual(expectedMs - 5_000);
    expect(
      result.expiresAt.getTime() - after,
    ).toBeLessThanOrEqual(expectedMs + 5_000);
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          deviceId: 'device-1',
        }),
      }),
    );
  });

  it('uses configured refresh token lifetime when provided', async () => {
    const prisma = {
      refreshToken: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };

    const service = new RefreshTokenService(
      prisma as never,
      {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'REFRESH_TOKEN_EXPIRES_DAYS') {
            return 120;
          }
          return undefined;
        }),
      } as never,
    );

    const before = Date.now();
    const result = await service.createRefreshToken('user-1');
    const expectedMs = 120 * 24 * 60 * 60 * 1000;

    expect(result.expiresAt.getTime() - before).toBeGreaterThanOrEqual(
      expectedMs - 5_000,
    );
  });
});
