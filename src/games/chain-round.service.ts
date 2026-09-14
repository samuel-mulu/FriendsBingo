import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  BingoClaimStatus,
  ChainRoundOutcome,
  GameCartelaStatus,
  GameCategory,
  GameStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  CHAIN_GAME_DEFAULT_INTER_ROUND_DELAY_SECONDS,
  CHAIN_GAME_MAX_PAUSE_EXTENSION_SECONDS,
  hasRemainingChainRounds,
  isChainDebugEnabled,
  resolveRoundPrizeAmount,
} from './chain-round.util';
import { resolveRoundGameRuleId } from './round-game-rule.util';

export type ChainRoundWinnerInput = {
  gameCartelaId: string;
  userId: string;
  cartelaNumber: number;
  amount: Prisma.Decimal;
};

export type ChainRoundSlotConfig = {
  id: string;
  category?: GameCategory | null;
  gameRuleId?: string | null;
  roundCount?: number | null;
  roundPrizes?: unknown;
  roundGameRuleIds?: unknown;
  interRoundDelaySeconds?: number | null;
  fixedPrizeAmount?: Prisma.Decimal | null;
};

export type ChainRoundAdvance = {
  pausedUntil: Date;
  finishedRoundIndex: number;
  nextRoundIndex: number;
  nextGameRuleId: string | null;
  nextRoundPrizeAmount: Prisma.Decimal;
};

/**
 * CHAIN_GAME round mechanics.
 *
 * A chain game plays every round inside ONE GameSession: the ball draw is never
 * restarted and marked cells are never cleared. A non-final round therefore must
 * NOT write GameStatus.FINISHED — the session stays PLAYING with auto-call
 * disabled and `roundPausedUntil` armed. That single invariant is what keeps the
 * NORMAL / BONUS / BIG_GOTD / BIG_GAME flows completely untouched, because every
 * existing terminal code path is gated on FINISHED / NO_WINNER.
 *
 * Deliberately independent of BigGameRoundService: Big Game creates a NEW session
 * per round, which is the opposite mechanic.
 */
@Injectable()
export class ChainRoundService {
  private readonly logger = new Logger(ChainRoundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

  isChainSlot(slot?: { category?: GameCategory | null } | null): boolean {
    return slot?.category === GameCategory.CHAIN_GAME;
  }

  /**
   * Prize actually at stake for the round being played. Chain sessions keep
   * `prizeAmount` as the whole-chain pool so existing reporting is unaffected,
   * so the payout must come from the per-round figure instead.
   */
  resolveActiveRoundPrize(session: {
    prizeAmount: Prisma.Decimal;
    roundIndex?: number | null;
    roundPrizeAmount?: Prisma.Decimal | null;
    gameSlot: ChainRoundSlotConfig;
  }): Prisma.Decimal {
    if (!this.isChainSlot(session.gameSlot)) {
      return session.prizeAmount;
    }

    if (session.roundPrizeAmount != null) {
      return session.roundPrizeAmount;
    }

    return resolveRoundPrizeAmount({
      roundIndex: session.roundIndex ?? 1,
      roundPrizes: session.gameSlot.roundPrizes,
      fallbackPrizeAmount: session.prizeAmount,
    });
  }

  /** True when this chain round is NOT the last one, i.e. the game must continue. */
  shouldContinueAfterRound(session: {
    roundIndex?: number | null;
    gameSlot: ChainRoundSlotConfig;
  }): boolean {
    if (!this.isChainSlot(session.gameSlot)) {
      return false;
    }

    return hasRemainingChainRounds({
      roundIndex: session.roundIndex ?? 1,
      roundCount: session.gameSlot.roundCount ?? 1,
    });
  }

  /**
   * The whole round plan for one chain session: every configured round with its
   * pattern, prize, and current state. Players need this up front because a
   * chain never opens registration again — the whole ladder is fixed at create.
   *
   * `WON` / `FORFEITED` come from persisted round results; `CURRENT` and
   * `UPCOMING` are derived from the session's live round index.
   */
  async getRoundPlan(sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        roundIndex: true,
        prizeAmount: true,
        roundPrizeAmount: true,
        roundPausedUntil: true,
        gameSlot: {
          select: {
            id: true,
            category: true,
            gameRuleId: true,
            roundCount: true,
            roundPrizes: true,
            roundGameRuleIds: true,
          },
        },
        roundResults: {
          orderBy: { roundIndex: 'asc' },
          select: {
            roundIndex: true,
            prizeAmount: true,
            paidAmount: true,
            outcome: true,
            finalizedAt: true,
            gameRule: { select: { key: true, name: true } },
            winners: {
              orderBy: { cartelaNumber: 'asc' },
              select: {
                gameCartelaId: true,
                cartelaNumber: true,
                amount: true,
              },
            },
          },
        },
      },
    });

    if (!session || !this.isChainSlot(session.gameSlot)) {
      throw new BadRequestException('Session is not a chain game.');
    }

    const roundCount = Math.max(1, session.gameSlot.roundCount ?? 1);
    const currentRound = session.roundIndex ?? 1;
    const resultByRound = new Map(
      session.roundResults.map((round) => [round.roundIndex, round]),
    );

    const ruleIds = Array.from({ length: roundCount }, (_unused, index) =>
      resolveRoundGameRuleId({
        roundIndex: index + 1,
        roundGameRuleIds: session.gameSlot.roundGameRuleIds,
        fallbackGameRuleId: session.gameSlot.gameRuleId,
      }),
    );
    const rules = await this.prisma.gameRule.findMany({
      where: {
        id: { in: [...new Set(ruleIds.filter((id): id is string => !!id))] },
      },
      select: { id: true, key: true, name: true },
    });
    const ruleById = new Map(rules.map((rule) => [rule.id, rule]));

    const rounds = Array.from({ length: roundCount }, (_unused, index) => {
      const roundIndex = index + 1;
      const result = resultByRound.get(roundIndex);
      const rule = result?.gameRule ?? ruleById.get(ruleIds[index] ?? '');
      const prizeAmount =
        result?.prizeAmount ??
        resolveRoundPrizeAmount({
          roundIndex,
          roundPrizes: session.gameSlot.roundPrizes,
          fallbackPrizeAmount: session.prizeAmount,
        });

      return {
        roundIndex,
        gameRuleKey: rule?.key ?? null,
        gameRuleName: rule?.name ?? null,
        prizeAmount: prizeAmount.toString(),
        paidAmount: result?.paidAmount?.toString() ?? null,
        state: result
          ? result.outcome
          : roundIndex === currentRound
            ? 'CURRENT'
            : 'UPCOMING',
        finalizedAt: result?.finalizedAt ?? null,
        winners:
          result?.winners.map((winner) => ({
            gameCartelaId: winner.gameCartelaId,
            cartelaNumber: winner.cartelaNumber,
            amount: winner.amount.toString(),
          })) ?? [],
      };
    });

    return {
      sessionId: session.id,
      roundCount,
      currentRound,
      roundPausedUntil: session.roundPausedUntil,
      totalPrizeAmount: session.prizeAmount.toString(),
      currentRoundPrizeAmount: (
        session.roundPrizeAmount ?? session.prizeAmount
      ).toString(),
      rounds,
    };
  }

  /** Persist one finished round (won or forfeited) plus its winners. */
  async recordRoundResult(
    tx: Prisma.TransactionClient,
    params: {
      sessionId: string;
      roundIndex: number;
      gameRuleId: string | null;
      prizeAmount: Prisma.Decimal;
      outcome: ChainRoundOutcome;
      winners: ChainRoundWinnerInput[];
      winningBall?: { letter: string; number: number } | null;
    },
  ): Promise<void> {
    const paidAmount = params.winners.reduce(
      (acc, winner) => acc.plus(winner.amount),
      new Prisma.Decimal(0),
    );

    // Recovery reruns must not double-write a round.
    const existing = await tx.gameSessionRoundResult.findUnique({
      where: {
        gameSessionId_roundIndex: {
          gameSessionId: params.sessionId,
          roundIndex: params.roundIndex,
        },
      },
      select: { id: true },
    });

    if (existing) {
      return;
    }

    await tx.gameSessionRoundResult.create({
      data: {
        gameSessionId: params.sessionId,
        roundIndex: params.roundIndex,
        gameRuleId: params.gameRuleId,
        prizeAmount: params.prizeAmount,
        paidAmount,
        outcome: params.outcome,
        winningBallLetter: params.winningBall?.letter ?? null,
        winningBallNumber: params.winningBall?.number ?? null,
        winners: {
          create: params.winners.map((winner) => ({
            gameCartelaId: winner.gameCartelaId,
            userId: winner.userId,
            cartelaNumber: winner.cartelaNumber,
            amount: winner.amount,
          })),
        },
      },
    });
  }

  /**
   * Non-final round finalize. Keeps the session PLAYING, arms the pause, and
   * rolls the session onto the next round's rule and prize.
   *
   * Winners are returned to REGISTERED so they keep playing: the round win is
   * recorded on GameSessionRoundWinner, not on the cartela. This also leaves
   * `assertClaimableCartela`'s ALREADY_WINNER guard correct as written — it now
   * only rejects a re-claim inside the same round.
   */
  async advanceToNextRound(
    tx: Prisma.TransactionClient,
    params: {
      sessionId: string;
      finishedRoundIndex: number;
      slot: ChainRoundSlotConfig;
      winnerCartelaIds: string[];
      now?: Date;
    },
  ): Promise<ChainRoundAdvance> {
    const now = params.now ?? new Date();
    const nextRoundIndex = params.finishedRoundIndex + 1;
    const delaySeconds =
      params.slot.interRoundDelaySeconds ??
      CHAIN_GAME_DEFAULT_INTER_ROUND_DELAY_SECONDS;
    const pausedUntil = new Date(now.getTime() + delaySeconds * 1000);

    const nextGameRuleId = resolveRoundGameRuleId({
      roundIndex: nextRoundIndex,
      roundGameRuleIds: params.slot.roundGameRuleIds,
      fallbackGameRuleId: params.slot.gameRuleId,
    });
    const nextRoundPrizeAmount = resolveRoundPrizeAmount({
      roundIndex: nextRoundIndex,
      roundPrizes: params.slot.roundPrizes,
      fallbackPrizeAmount: params.slot.fixedPrizeAmount,
    });

    if (params.winnerCartelaIds.length > 0) {
      await tx.gameCartela.updateMany({
        where: {
          id: { in: params.winnerCartelaIds },
          status: GameCartelaStatus.WINNER,
        },
        data: {
          status: GameCartelaStatus.REGISTERED,
          isWinner: false,
        },
      });
    }

    await tx.gameSession.update({
      where: { id: params.sessionId },
      data: {
        // Stays PLAYING on purpose. FINISHED here would drag the whole session
        // through the standard terminal flow (slot teardown, next-game opener,
        // client post-game summary) mid-chain.
        status: GameStatus.PLAYING,
        roundPausedUntil: pausedUntil,
        autoCallEnabled: false,
        nextAutoCallAt: null,
        roundIndex: nextRoundIndex,
        gameRuleId: nextGameRuleId,
        roundPrizeAmount: nextRoundPrizeAmount,
        // Release the finalize latch so the next round can open its own window.
        winnerCartelaId: null,
        winnerWindowStartedAt: null,
        winnerWindowEndsAt: null,
        prizeFinalizedAt: null,
        finishedAt: null,
        noWinnerGraceEndsAt: null,
        noWinnerReason: null,
      },
    });

    await tx.gameSlot.update({
      where: { id: params.slot.id },
      data: { currentRound: nextRoundIndex },
    });

    this.logger.log(
      `Chain round ${params.finishedRoundIndex} finished on session ${params.sessionId}; ` +
        `round ${nextRoundIndex} resumes at ${pausedUntil.toISOString()}`,
    );
    if (isChainDebugEnabled()) {
      this.logger.log(
        `[chain] advanceToNextRound session=${params.sessionId} ` +
          `round ${params.finishedRoundIndex} -> ${nextRoundIndex} ` +
          `pausedUntil=${pausedUntil.toISOString()} autoCallEnabled=false`,
      );
    }

    return {
      pausedUntil,
      finishedRoundIndex: params.finishedRoundIndex,
      nextRoundIndex,
      nextGameRuleId,
      nextRoundPrizeAmount,
    };
  }

  /**
   * Mid-chain NO_WINNER: the balls ran out, so no later round can be played.
   * Every remaining round is recorded as FORFEITED with paidAmount 0 so the gap
   * between the configured pool and what was actually paid stays visible in reports.
   */
  async forfeitRemainingRounds(
    tx: Prisma.TransactionClient,
    params: {
      sessionId: string;
      fromRoundIndex: number;
      slot: ChainRoundSlotConfig;
    },
  ): Promise<number> {
    const roundCount = params.slot.roundCount ?? 1;
    let forfeited = 0;

    for (
      let roundIndex = params.fromRoundIndex;
      roundIndex <= roundCount;
      roundIndex += 1
    ) {
      await this.recordRoundResult(tx, {
        sessionId: params.sessionId,
        roundIndex,
        gameRuleId: resolveRoundGameRuleId({
          roundIndex,
          roundGameRuleIds: params.slot.roundGameRuleIds,
          fallbackGameRuleId: params.slot.gameRuleId,
        }),
        prizeAmount: resolveRoundPrizeAmount({
          roundIndex,
          roundPrizes: params.slot.roundPrizes,
          fallbackPrizeAmount: params.slot.fixedPrizeAmount,
        }),
        outcome: ChainRoundOutcome.FORFEITED,
        winners: [],
      });
      forfeited += 1;
    }

    return forfeited;
  }

  /**
   * Invalidate claims still PENDING when a round closes so they cannot resolve
   * against the next round's pattern.
   */
  async invalidateStalePendingClaims(
    tx: Prisma.TransactionClient,
    params: { sessionId: string; roundIndex: number },
  ): Promise<void> {
    await tx.bingoClaim.updateMany({
      where: {
        gameSessionId: params.sessionId,
        status: BingoClaimStatus.PENDING,
      },
      data: {
        status: BingoClaimStatus.INVALID,
        reason: `Round ${params.roundIndex} closed before this claim was checked`,
        checkedAt: new Date(),
      },
    });
  }

  /** Admin: end the pause immediately. */
  async continueNow(sessionId: string): Promise<Date> {
    const session = await this.requirePausedSession(sessionId);
    const now = new Date();

    await this.prisma.gameSession.update({
      where: { id: session.id },
      data: { roundPausedUntil: now },
    });

    this.logger.log(
      `Chain round pause ended early by admin for session ${sessionId}`,
    );
    return now;
  }

  /** Admin: give players more time on the winner reveal. */
  async extendPause(sessionId: string, seconds: number): Promise<Date> {
    if (
      !Number.isInteger(seconds) ||
      seconds < 1 ||
      seconds > CHAIN_GAME_MAX_PAUSE_EXTENSION_SECONDS
    ) {
      throw new BadRequestException(
        `seconds must be between 1 and ${CHAIN_GAME_MAX_PAUSE_EXTENSION_SECONDS}`,
      );
    }

    const session = await this.requirePausedSession(sessionId);
    const base = session.roundPausedUntil!.getTime();
    const extended = new Date(
      Math.max(base, Date.now()) + seconds * 1000,
    );

    await this.prisma.gameSession.update({
      where: { id: session.id },
      data: { roundPausedUntil: extended },
    });

    this.logger.log(
      `Chain round pause extended by ${seconds}s for session ${sessionId}`,
    );
    return extended;
  }

  private async requirePausedSession(sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        roundPausedUntil: true,
        gameSlot: { select: { category: true } },
      },
    });

    if (!session || !this.isChainSlot(session.gameSlot)) {
      throw new BadRequestException('Session is not a chain game');
    }

    if (
      session.status !== GameStatus.PLAYING ||
      session.roundPausedUntil == null
    ) {
      throw new BadRequestException('Chain game is not between rounds');
    }

    return session;
  }

  emitRoundFinished(payload: {
    sessionId: string;
    slotId: string;
    finishedRoundIndex: number;
    roundCount: number;
    pausedUntil: string;
    nextRoundIndex: number;
    nextRoundPrizeAmount: string;
    roundPrizeAmount: string;
    winners: Array<{
      gameCartelaId: string;
      cartelaNumber: number;
      amount: string;
    }>;
  }): void {
    if (isChainDebugEnabled()) {
      this.logger.log(
        `[chain] emit chain:round_finished session=${payload.sessionId} ` +
          `finishedRound=${payload.finishedRoundIndex} nextRound=${payload.nextRoundIndex} ` +
          `pausedUntil=${payload.pausedUntil}`,
      );
    }
    this.realtimeService.emitToSession(
      payload.sessionId,
      'chain:round_finished',
      payload,
    );
    this.realtimeService.emitToAdmin('chain:round_finished', payload);
    this.realtimeService.emitToPublicGames('chain:round_finished', payload);
  }

  emitRoundStarted(payload: {
    sessionId: string;
    slotId: string;
    roundIndex: number;
    roundCount: number;
    roundPrizeAmount: string;
    gameRuleId: string | null;
  }): void {
    if (isChainDebugEnabled()) {
      this.logger.log(
        `[chain] emit chain:round_started session=${payload.sessionId} ` +
          `round=${payload.roundIndex}/${payload.roundCount}`,
      );
    }
    this.realtimeService.emitToSession(
      payload.sessionId,
      'chain:round_started',
      payload,
    );
    this.realtimeService.emitToAdmin('chain:round_started', payload);
    this.realtimeService.emitToPublicGames('chain:round_started', payload);
  }
}
