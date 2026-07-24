import {
  BingoClaimStatus,
  GameCartelaStatus,
  GameStatus,
  Prisma,
} from '@prisma/client';
import { CalledNumberEvaluationRecord } from '../called-numbers/called-numbers.select';
import { serializeCompletedPatterns } from '../bingo-claims/completed-patterns.mapper';
import { splitPrizeAmount } from '../bingo-claims/prize-split.util';
import {
  resolveAcceptedEvaluation,
  resolveWinningBallFromCalledNumbersSnapshot,
  resolveWinningBallFromEvaluation,
  WinningBallRecord,
} from '../bingo-claims/winning-ball.util';
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

  return candidate;
}

const calledNumberSnapshotSelect =
  Prisma.validator<Prisma.CalledNumberSelect>()({
    letter: true,
    number: true,
    order: true,
    createdAt: true,
  });

type CalledNumberSnapshot = Prisma.CalledNumberGetPayload<{
  select: typeof calledNumberSnapshotSelect;
}>;

export function filterCalledNumbersAtClaimTime(
  calledNumbers: CalledNumberSnapshot[],
  claimCheckedAt: Date,
): CalledNumberEvaluationRecord[] {
  const cutoffMs = claimCheckedAt.getTime();

  return calledNumbers
    .filter((entry) => entry.createdAt.getTime() <= cutoffMs)
    .map(({ letter, number, order }) => ({ letter, number, order }));
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
  bingoClaim: {
    findMany: Prisma.BingoClaimDelegate['findMany'];
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

  if (
    !session ||
    (session.status !== GameStatus.FINISHED &&
      session.status !== GameStatus.NO_WINNER &&
      session.status !== GameStatus.WINNER_WINDOW)
  ) {
    return [];
  }

  const [winners, calledNumbers, claims] = await Promise.all([
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
      select: calledNumberSnapshotSelect,
    }),
    prisma.bingoClaim.findMany({
      where: {
        gameSessionId: sessionId,
        status: BingoClaimStatus.VALID,
      },
      select: {
        gameCartelaId: true,
        checkedAt: true,
        winningBallLetter: true,
        winningBallNumber: true,
      },
      orderBy: { checkedAt: 'asc' },
    }),
  ]);

  if (winners.length === 0) {
    return [];
  }

  const winnerCartelaIds = new Set(winners.map((winner) => winner.id));
  const claimCheckedAtByCartelaId = new Map<string, Date>();
  const winningBallByCartelaId = new Map<string, WinningBallRecord>();
  for (const claim of claims) {
    if (!claim.checkedAt || !winnerCartelaIds.has(claim.gameCartelaId)) {
      continue;
    }

    if (!claimCheckedAtByCartelaId.has(claim.gameCartelaId)) {
      claimCheckedAtByCartelaId.set(claim.gameCartelaId, claim.checkedAt);
      if (claim.winningBallLetter != null && claim.winningBallNumber != null) {
        winningBallByCartelaId.set(claim.gameCartelaId, {
          letter: claim.winningBallLetter,
          number: claim.winningBallNumber,
        });
      }
    }
  }

  const ruleKey = session.gameSlot.gameRule?.key ?? session.gameSlot.gameType;
  const shares = splitPrizeAmount(session.prizeAmount, winners.length);
  const sessionLastCalledNumber = resolveWinningBallFromCalledNumbersSnapshot(
    calledNumbers.map(({ letter, number, order }) => ({
      letter,
      number,
      order,
    })),
  );

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
    const claimCheckedAt = claimCheckedAtByCartelaId.get(winner.id);
    const winnerCalledNumbers = claimCheckedAt
      ? filterCalledNumbersAtClaimTime(calledNumbers, claimCheckedAt)
      : calledNumbers.map(({ letter, number, order }) => ({
          letter,
          number,
          order,
        }));

    const evaluation = resolveAcceptedEvaluation(
      evaluationService,
      evaluatorCartela,
      winnerCalledNumbers,
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

    const storedWinningBall = winningBallByCartelaId.get(winner.id);
    const lastCalledNumber =
      sessionLastCalledNumber ??
      storedWinningBall ??
      resolveWinningBallFromEvaluation(winnerCalledNumbers, evaluation);

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
