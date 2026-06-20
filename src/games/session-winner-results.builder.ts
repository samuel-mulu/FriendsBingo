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

export type SessionWinnerLastCalledNumber = {
  letter: string;
  number: number;
};

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
  winningBallCellIndex?: number | null;
  lastCalledNumber?: SessionWinnerLastCalledNumber | null;
};

type EvaluatorCartelaColumns = {
  b: unknown;
  i: unknown;
  n: unknown;
  g: unknown;
  o: unknown;
};

export function cellIndexForCalledNumber(
  cartela: EvaluatorCartelaColumns,
  calledNumber: number,
): number | null {
  const columns = [cartela.b, cartela.i, cartela.n, cartela.g, cartela.o];

  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const column = columns[columnIndex];
    if (!Array.isArray(column)) {
      continue;
    }

    for (let rowIndex = 0; rowIndex < column.length; rowIndex += 1) {
      const raw = column[rowIndex];
      if (raw === 'FREE') {
        continue;
      }

      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed === calledNumber) {
        return rowIndex * 5 + columnIndex;
      }
    }
  }

  return null;
}

export function resolveWinningBallCellIndex(
  cartela: EvaluatorCartelaColumns,
  calledNumber: SessionWinnerLastCalledNumber | null | undefined,
  completedPatterns: ReturnType<typeof serializeCompletedPatterns>,
): number | null {
  if (!calledNumber) {
    return null;
  }

  const candidate = cellIndexForCalledNumber(cartela, calledNumber.number);
  if (candidate == null) {
    return null;
  }

  const winningCells = new Set<number>();
  for (const pattern of completedPatterns) {
    for (const cell of pattern.cells) {
      winningCells.add(cell[0] * 5 + cell[1]);
    }
  }

  return winningCells.has(candidate) ? candidate : null;
}

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
  const lastCalled = calledNumbers.at(-1);
  const lastCalledNumber = lastCalled
    ? {
        letter: lastCalled.letter,
        number: lastCalled.number,
      }
    : null;

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

    const winningBallCellIndex = resolveWinningBallCellIndex(
      evaluatorCartela,
      lastCalledNumber,
      completedPatterns,
    );

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
      winningBallCellIndex,
      lastCalledNumber,
    };
  });
}
