import {
  GameCartelaStatus,
  GameStatus,
  Prisma,
} from '@prisma/client';
import { calledNumberEvaluationSelect } from '../called-numbers/called-numbers.select';
import { serializeCompletedPatterns } from '../bingo-claims/completed-patterns.mapper';
import { splitPrizeAmount } from '../bingo-claims/prize-split.util';
import { GameRuleEvaluationService } from '../game-rules/game-rule-evaluation.service';
import { myGameCartelaSelect } from './games.select';

export type SessionWinnerResult = {
  gameCartelaId: string;
  cartelaId: string;
  cartelaNumber: number;
  owner?: 'ME' | 'OTHER';
  amount: string;
  b: unknown;
  i: unknown;
  n: unknown;
  g: unknown;
  o: unknown;
  completedPatterns: ReturnType<typeof serializeCompletedPatterns>;
};

type PrismaClientLike = {
  gameSession: {
    findUnique: Prisma.GameSessionDelegate['findUnique'];
  };
  gameCartela: {
    findMany: Prisma.GameCartelaDelegate['findMany'];
  };
  calledNumber: {
    findMany: Prisma.CalledNumberDelegate['findMany'];
  };
};

export async function buildSessionWinnerResults(
  prisma: PrismaClientLike,
  sessionId: string,
  evaluationService: GameRuleEvaluationService,
  requestingUserId?: string,
): Promise<SessionWinnerResult[]> {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      prizeAmount: true,
      gameSlot: {
        select: {
          gameType: true,
          gameRule: {
            select: {
              key: true,
              patterns: true,
            },
          },
        },
      },
    },
  });

  if (!session || session.status !== GameStatus.FINISHED) {
    return [];
  }

  const [winners, calledNumbers] = await Promise.all([
    prisma.gameCartela.findMany({
      where: {
        gameSessionId: sessionId,
        isWinner: true,
        status: GameCartelaStatus.WINNER,
      },
      select: myGameCartelaSelect,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.calledNumber.findMany({
      where: { gameSessionId: sessionId },
      orderBy: { order: 'asc' },
      select: calledNumberEvaluationSelect,
    }),
  ]);

  if (winners.length === 0) {
    return [];
  }

  const ruleKey =
    session.gameSlot.gameRule?.key ?? session.gameSlot.gameType;
  const shares = splitPrizeAmount(session.prizeAmount, winners.length);

  return winners.map((winner, index) => {
    const cartela = winner.cartela;
    const evaluatorCartela = {
      id: cartela.id,
      number: cartela.number,
      b: cartela.b,
      i: cartela.i,
      n: cartela.n,
      g: cartela.g,
      o: cartela.o,
    };
    const evaluation = evaluationService.evaluate(
      evaluatorCartela,
      calledNumbers,
      ruleKey,
      session.gameSlot.gameRule?.patterns,
    );
    const completedPatterns =
      evaluation.isWinner && evaluation.completedPatterns.length > 0
        ? serializeCompletedPatterns(
            evaluation.completedPatterns,
            evaluatorCartela,
          )
        : [];

    return {
      gameCartelaId: winner.id,
      cartelaId: winner.cartelaId,
      cartelaNumber: cartela.number,
      ...(requestingUserId
        ? {
            owner:
              winner.userId === requestingUserId
                ? ('ME' as const)
                : ('OTHER' as const),
          }
        : {}),
      amount: shares[index].toFixed(2),
      b: cartela.b,
      i: cartela.i,
      n: cartela.n,
      g: cartela.g,
      o: cartela.o,
      completedPatterns,
    };
  });
}
