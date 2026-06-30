import { Prisma } from '@prisma/client';
import { isPrismaConnectivityError } from './prisma-connectivity.util';

describe('isPrismaConnectivityError', () => {
  it('detects Prisma pool and transaction timeout codes', () => {
    for (const code of ['P1001', 'P1008', 'P1017', 'P2024', 'P2028']) {
      const error = new Prisma.PrismaClientKnownRequestError('db unavailable', {
        code,
        clientVersion: '7.8.0',
      });

      expect(isPrismaConnectivityError(error)).toBe(true);
    }
  });

  it('detects pg pool connection termination messages', () => {
    expect(
      isPrismaConnectivityError(
        new Error('Connection terminated unexpectedly'),
      ),
    ).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isPrismaConnectivityError(new Error('Unique constraint failed'))).toBe(
      false,
    );
  });
});
