import { Prisma } from '@prisma/client';

const PRISMA_CONNECTIVITY_ERROR_CODES = new Set([
  'P1001',
  'P1008',
  'P1017',
  'P2024',
  'P2028',
]);

export function isPrismaConnectivityError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    PRISMA_CONNECTIVITY_ERROR_CODES.has(error.code)
  ) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('connection terminated unexpectedly') ||
    message.includes('connection terminated due to connection timeout') ||
    message.includes('server closed the connection unexpectedly')
  );
}
