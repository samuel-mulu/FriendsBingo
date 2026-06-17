import { GameCartelaStatus, Prisma } from '@prisma/client';

export type SessionOutcomeSummary = {
  winnerCartelaNumbers: number[];
  blockedCartelaNumbers: number[];
};

type PrismaClientLike = {
  gameCartela: {
    findMany: Prisma.GameCartelaDelegate['findMany'];
  };
};

export async function buildSessionOutcomeSummary(
  prisma: PrismaClientLike,
  sessionId: string,
): Promise<SessionOutcomeSummary> {
  const [winners, blocked] = await Promise.all([
    prisma.gameCartela.findMany({
      where: {
        gameSessionId: sessionId,
        isWinner: true,
        status: GameCartelaStatus.WINNER,
      },
      select: {
        cartela: {
          select: { number: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.gameCartela.findMany({
      where: {
        gameSessionId: sessionId,
        status: GameCartelaStatus.BLOCKED,
      },
      select: {
        cartela: {
          select: { number: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const winnerNumbers = winners
    .map((entry) => entry.cartela.number)
    .sort((left, right) => left - right);
  const blockedNumbers = blocked
    .map((entry) => entry.cartela.number)
    .sort((left, right) => left - right);

  return {
    winnerCartelaNumbers: winnerNumbers,
    blockedCartelaNumbers: blockedNumbers,
  };
}
