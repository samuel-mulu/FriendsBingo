import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BingoClaimStatus,
  BigGameTicketLedgerType,
  ChainRoundOutcome,
  GameCartelaStatus,
  GameCategory,
  GameStatus,
  Prisma,
  UserRole,
  WalletTransactionType,
} from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { isPrismaConnectivityError } from '../common/filters/prisma-connectivity.util';
import { RequestPerformanceContext } from '../common/performance/request-performance.context';
import { AuditLogService } from '../common/services/audit-log.service';
import {
  buildPaginationMeta,
  getPaginationParams,
} from '../common/utils/pagination.util';
import { calledNumberEvaluationSelect } from '../called-numbers/called-numbers.select';
import { CompletedPattern } from '../game-rules/interfaces/game-rule-evaluator.interface';
import { GameRuleEvaluationService } from '../game-rules/game-rule-evaluation.service';
import {
  serializeCompletedPatterns,
  SerializedCompletedPattern,
} from './completed-patterns.mapper';
import { GameEngineService } from '../game-engine/game-engine.service';
import {
  serializeGameSession,
  serializeGameSlot,
  toPlayerGameSession,
  toPlayerGameSlot,
  withTerminalSessionContextForAdminSlot,
  withTerminalSessionContextForPlayerSlot,
} from '../games/games.mapper';
import { GameQueueService } from '../games/game-queue.service';
import { BigGameRoundService } from '../games/big-game-round.service';
import { BigGameTicketService } from '../games/big-game-ticket.service';
import {
  ChainRoundAdvance,
  ChainRoundService,
} from '../games/chain-round.service';
import { PostGameRegistrationOpenerService } from '../games/post-game-registration-opener.service';
import { gameSessionSelect, gameSlotSelect } from '../games/games.select';
import { OperationsCacheService } from '../games/operations-cache.service';
import { GamePushNotificationsService } from '../notifications/game-push-notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WalletService } from '../wallet/wallet.service';
import { GameTimingConfigService } from '../game-timing-config/game-timing-config.service';
import {
  resolveWinningBallFromCalledNumbersSnapshot,
  WinningBallRecord,
} from './winning-ball.util';
import { RejectBingoClaimDto } from './dto/reject-bingo-claim.dto';
import { CreateBingoClaimDto } from './dto/create-bingo-claim.dto';
import {
  BingoClaimReasonCode,
  serializeAdminBingoAttempt,
  serializeBingoClaim,
  serializePlayerBingoClaim,
} from './bingo-claims.mapper';
import {
  bingoClaimSelect,
  createdPlayerBingoClaimSelect,
  CreatedPlayerBingoClaimRecord,
  finalClaimStatuses,
} from './bingo-claims.select';
import { resolveForceBigGameTicketsPerWinner } from './force-big-game-tickets.util';
import {
  prizeLedgerReferenceId,
  splitPrizeAmount,
} from './prize-split.util';
import { canForceBigGameTickets } from '../games/game-category.util';
import {
  resolveSessionGameRule,
  resolveSessionGameRuleKey,
} from '../games/round-game-rule.util';
import { isChainDebugEnabled } from '../games/chain-round.util';
import { RequestContextService } from '../observability/request-context.service';

/** Matches game-engine / big-game critical-path interactive txn convention. */
const CLAIM_VALIDATION_TXN_OPTIONS = {
  maxWait: 20_000,
  timeout: 20_000,
} as const;

type BingoClaimFailureCode =
  | 'DB_TRANSACTION_TIMEOUT'
  | 'DB_UNAVAILABLE'
  | 'CLAIM_STATE_CONFLICT'
  | 'VALIDATION_INTERNAL_ERROR';

type ClaimCartelaRecord = {
  id: string;
  gameSessionId: string;
  userId: string;
  status: GameCartelaStatus;
  isWinner: boolean;
  cartela: {
    id: string;
    number: number;
    b: Prisma.JsonValue;
    i: Prisma.JsonValue;
    n: Prisma.JsonValue;
    g: Prisma.JsonValue;
    o: Prisma.JsonValue;
  };
  gameSession: {
    id: string;
    playCode: string;
    status: GameStatus;
    prizeAmount: Prisma.Decimal;
    autoCallEnabled: boolean;
    autoCallIntervalMs: number | null;
    nextAutoCallAt: Date | null;
    winnerWindowEndsAt: Date | null;
    gameRule: {
      id: string;
      key: string;
      name: string;
      patterns: unknown;
    } | null;
    gameSlot: {
      id: string;
      gameType: string;
      gameRule: {
        id: string;
        key: string;
        name: string;
        patterns: unknown;
      } | null;
    };
  };
};

type PlayerClaimPayload = ReturnType<typeof serializePlayerBingoClaim>;

const AUTO_INVALID_REASONS: Record<
  Extract<BingoClaimReasonCode, 'INVALID_PATTERN' | 'INVALID_LATE_CLAIM'>,
  string
> = {
  INVALID_PATTERN: 'Claim did not match the active game rule pattern',
  INVALID_LATE_CLAIM:
    'Claim was too late because the latest called number did not complete the winning pattern',
};

const TERMINAL_CLAIM_REASONS: Record<
  Extract<BingoClaimReasonCode, 'ALREADY_BLOCKED' | 'ALREADY_WINNER'>,
  string
> = {
  ALREADY_BLOCKED: 'Blocked cartelas cannot claim bingo again',
  ALREADY_WINNER: 'This cartela is already the winner',
};

type ClaimLeanAutoCall = {
  autoCallEnabled: boolean;
  autoCallIntervalMs: number | null;
  nextAutoCallAt: string | null;
};

type ClaimSideEffectResult = {
  kind:
    | 'already_resolved'
    | 'manual_pending'
    | 'auto_invalid'
    | 'auto_valid_open'
    | 'auto_valid_join'
    | 'auto_failed';
  sessionId: string;
  slotId: string;
  gameStatus: GameStatus;
  userId: string;
  gameCartelaId: string;
  cartelaNumber?: number;
  claim: PlayerClaimPayload;
  winnerWindowEndsAt?: Date;
  completedPatterns?: SerializedCompletedPattern[];
  lastCalledNumber?: WinningBallRecord | null;
  leanAutoCall?: ClaimLeanAutoCall;
  response: Record<string, unknown>;
  sessionStatusBefore?: GameStatus;
  cartelaStatusBefore?: GameCartelaStatus;
  retryAllowed?: boolean;
};

type AcceptClaimResult =
  | {
      kind: 'already_resolved' | 'manual_pending';
      sideEffect: ClaimSideEffectResult;
    }
  | {
      kind: 'auto_checking';
      claimId: string;
      claimAttemptId: string;
      attemptNumber: number;
      receivedAt: Date;
      gameCartela: ClaimCartelaRecord;
      ruleKey: string;
      pausedRemainingMs: number;
      hadScheduledAutoCall: boolean;
      cartelaNumber: number;
    };


@Injectable()
export class BingoClaimsService {
  private readonly logger = new Logger(BingoClaimsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gameEngineService: GameEngineService,
    private readonly gameRuleEvaluationService: GameRuleEvaluationService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
    private readonly walletService: WalletService,
    private readonly gameQueueService: GameQueueService,
    private readonly requestPerformance: RequestPerformanceContext,
    private readonly gameTimingConfigService: GameTimingConfigService,
    private readonly operationsCacheService: OperationsCacheService,
    private readonly postGameRegistrationOpenerService: PostGameRegistrationOpenerService,
    private readonly gamePushNotificationsService: GamePushNotificationsService,
    private readonly bigGameTicketService: BigGameTicketService,
    private readonly bigGameRoundService: BigGameRoundService,
    private readonly chainRoundService: ChainRoundService,
    private readonly requestContext: RequestContextService,
  ) {}

  async claimBingo(
    sessionId: string,
    userId: string,
    createBingoClaimDto: CreateBingoClaimDto,
  ) {
    const httpStartedAt = Date.now();
    const gameCartelaId = createBingoClaimDto.gameCartelaId;
    const claimAttemptId = createBingoClaimDto.claimAttemptId;
    const clientTapAt = createBingoClaimDto.clientTapAt
      ? new Date(createBingoClaimDto.clientTapAt)
      : null;
    const requestId = this.requestContext.getRequestIdForLog();

    this.logBingoClaimStage({
      claimAttemptId,
      sessionId,
      gameCartelaId,
      userId,
      stage: 'received',
    });

    return this.requestPerformance.run(
      {
        operation: 'claimBingo',
        userRole: UserRole.PLAYER,
      },
      async () => {
        const existingByAttempt = await this.prisma.bingoClaim.findUnique({
          where: { claimAttemptId },
          select: createdPlayerBingoClaimSelect,
        });

        if (existingByAttempt) {
          if (existingByAttempt.userId !== userId) {
            throw new NotFoundException('Bingo claim attempt not found');
          }
          if (existingByAttempt.gameSessionId !== sessionId) {
            throw new BadRequestException(
              'Claim attempt does not belong to this session',
            );
          }
          return this.buildIdempotentClaimResponse(existingByAttempt);
        }

        const acceptStartedAt = Date.now();
        let accepted: AcceptClaimResult;
        try {
          accepted = await this.prisma.$transaction(
            async (tx) =>
              this.acceptClaimAttempt(tx, {
                sessionId,
                userId,
                gameCartelaId,
                claimAttemptId,
                clientTapAt,
                requestId,
              }),
            { maxWait: 10_000, timeout: 10_000 },
          );
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            const raced = await this.prisma.bingoClaim.findUnique({
              where: { claimAttemptId },
              select: createdPlayerBingoClaimSelect,
            });
            if (raced && raced.userId === userId) {
              return this.buildIdempotentClaimResponse(raced);
            }
          }
          throw error;
        }

        this.logBingoClaimStage({
          claimAttemptId,
          sessionId,
          gameCartelaId,
          userId,
          attemptNumber:
            accepted.kind === 'auto_checking'
              ? accepted.attemptNumber
              : accepted.sideEffect.claim.attemptNumber,
          stage: 'attempt_persisted',
          durationMs: Date.now() - acceptStartedAt,
        });

        if (accepted.kind !== 'auto_checking') {
          if (accepted.kind === 'manual_pending') {
            this.emitClaimCriticalRealtime(accepted.sideEffect);
            void this.runDeferredClaimStructuralRefresh(accepted.sideEffect);
          }
          this.logBingoClaimPerf({
            sessionId,
            gameCartelaId,
            claimBranch: accepted.sideEffect.kind,
            claimStatus: String(accepted.sideEffect.claim.status),
            reasonCode:
              (accepted.sideEffect.response.reasonCode as string | null) ??
              null,
            transactionMs: Date.now() - acceptStartedAt,
            postCommitCriticalMs: 0,
            totalHttpMs: Date.now() - httpStartedAt,
            sessionBefore: accepted.sideEffect.sessionStatusBefore ?? null,
            sessionAfter: accepted.sideEffect.gameStatus,
            cartelaAfter: String(
              accepted.sideEffect.response.gameCartelaStatus ?? '',
            ),
          });
          return accepted.sideEffect.response;
        }

        this.realtimeService.emitToGame(sessionId, 'game:bingo_checking', {
          sessionId,
          userId,
          gameCartelaId,
          claimAttemptId,
          cartelaNumber: accepted.cartelaNumber,
          nextAutoCallAt: null,
        });
        this.logBingoClaimStage({
          claimAttemptId,
          sessionId,
          gameCartelaId,
          userId,
          attemptNumber: accepted.attemptNumber,
          stage: 'checking_emitted',
          latestCalledNumber:
            accepted.gameCartela.gameSession.status != null
              ? undefined
              : undefined,
        });

        const txnStartedAt = Date.now();
        this.logBingoClaimStage({
          claimAttemptId,
          sessionId,
          gameCartelaId,
          userId,
          attemptNumber: accepted.attemptNumber,
          stage: 'transaction_started',
        });

        let result: ClaimSideEffectResult;
        try {
          result = await this.prisma.$transaction(
            async (tx) =>
              this.createAutoValidatedClaim(
                tx,
                accepted.gameCartela,
                userId,
                accepted.ruleKey,
                {
                  existingClaimId: accepted.claimId,
                  claimAttemptId: accepted.claimAttemptId,
                  receivedAt: accepted.receivedAt,
                  pausedRemainingMs: accepted.pausedRemainingMs,
                  hadScheduledAutoCall: accepted.hadScheduledAutoCall,
                  autoCallAlreadyPaused: true,
                },
              ),
            CLAIM_VALIDATION_TXN_OPTIONS,
          );
        } catch (error) {
          // Never leave a public CHECKING attempt without a durable terminal row.
          // Business-rule INVALID/VALID paths do not throw — they return side effects.
          // BadRequest (e.g. window closed) and infra/conflict all finalize FAILED.
          result = await this.finalizeFailedClaimAttempt({
            claimId: accepted.claimId,
            claimAttemptId: accepted.claimAttemptId,
            sessionId,
            userId,
            gameCartelaId,
            cartelaNumber: accepted.cartelaNumber,
            slotId: accepted.gameCartela.gameSession.gameSlot.id,
            gameStatus: accepted.gameCartela.gameSession.status,
            receivedAt: accepted.receivedAt,
            pausedRemainingMs: accepted.pausedRemainingMs,
            hadScheduledAutoCall: accepted.hadScheduledAutoCall,
            autoCallEnabled: accepted.gameCartela.gameSession.autoCallEnabled,
            autoCallIntervalMs:
              accepted.gameCartela.gameSession.autoCallIntervalMs,
            error,
          });
        }

        const transactionMs = Date.now() - txnStartedAt;
        this.logBingoClaimStage({
          claimAttemptId,
          sessionId,
          gameCartelaId,
          userId,
          attemptNumber: accepted.attemptNumber,
          stage:
            result.kind === 'auto_failed'
              ? 'failed'
              : 'transaction_committed',
          durationMs: transactionMs,
          result: String(result.claim.status),
          failureCode: result.claim.failureCode ?? undefined,
        });

        const criticalStartedAt = Date.now();
        if (result.kind !== 'already_resolved') {
          this.emitClaimCriticalRealtime(result);
          void this.runDeferredClaimStructuralRefresh(result);
        }
        this.logBingoClaimStage({
          claimAttemptId,
          sessionId,
          gameCartelaId,
          userId,
          attemptNumber: accepted.attemptNumber,
          stage: 'terminal_event_emitted',
          durationMs: Date.now() - criticalStartedAt,
          result: String(result.claim.status),
        });

        this.logBingoClaimPerf({
          sessionId,
          gameCartelaId,
          claimBranch: result.kind,
          claimStatus: String(result.claim.status),
          reasonCode:
            (result.response.reasonCode as string | null | undefined) ?? null,
          transactionMs,
          postCommitCriticalMs: Date.now() - criticalStartedAt,
          totalHttpMs: Date.now() - httpStartedAt,
          sessionBefore: result.sessionStatusBefore ?? null,
          sessionAfter: result.gameStatus,
          cartelaAfter: String(result.response.gameCartelaStatus ?? ''),
        });

        return result.response;
      },
    );
  }

  async getPlayerBingoClaimAttempt(
    sessionId: string,
    userId: string,
    claimAttemptId: string,
  ) {
    const claim = await this.prisma.bingoClaim.findFirst({
      where: {
        claimAttemptId,
        gameSessionId: sessionId,
        userId,
      },
      select: {
        ...createdPlayerBingoClaimSelect,
        gameCartela: {
          select: {
            status: true,
            isWinner: true,
          },
        },
        gameSession: {
          select: {
            status: true,
            nextAutoCallAt: true,
            winnerWindowEndsAt: true,
          },
        },
      },
    });

    if (!claim) {
      throw new NotFoundException('Bingo claim attempt not found');
    }

    const retryAllowed =
      claim.status === BingoClaimStatus.FAILED ||
      (claim.status === BingoClaimStatus.ALREADY_RESOLVED &&
        claim.gameCartela.status === GameCartelaStatus.REGISTERED);

    return {
      claimAttemptId: claim.claimAttemptId,
      status: claim.status,
      gameCartelaStatus: claim.gameCartela.status,
      gameStatus: claim.gameSession.status,
      isWinner:
        claim.status === BingoClaimStatus.VALID ||
        claim.gameCartela.isWinner === true,
      retryAllowed,
      reasonCode: claim.reasonCode,
      failureCode: claim.failureCode,
      nextAutoCallAt: claim.gameSession.nextAutoCallAt?.toISOString() ?? null,
      winnerWindowEndsAt:
        claim.gameSession.winnerWindowEndsAt?.toISOString() ?? null,
      attemptNumber: claim.attemptNumber,
      receivedAt: claim.receivedAt.toISOString(),
      completedAt: claim.completedAt?.toISOString() ?? null,
      durationMs: claim.durationMs,
    };
  }

  async getAdminSessionBingoAttempts(sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!session) {
      throw new NotFoundException('Game session not found');
    }

    const claims = await this.prisma.bingoClaim.findMany({
      where: { gameSessionId: sessionId },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      select: bingoClaimSelect,
    });

    return {
      sessionId,
      attemptCount: claims.length,
      items: claims.map((claim) => serializeAdminBingoAttempt(claim)),
    };
  }

  async finalizeWinnerWindow(sessionId: string) {
    const graceMs =
      await this.gameTimingConfigService.getWinnerWindowClaimGraceMs();
    const finalizeAfter = new Date(Date.now() - graceMs);

    const finalized = await this.prisma.$transaction(async (tx) => {
      const lockResult = await tx.gameSession.updateMany({
        where: {
          id: sessionId,
          status: GameStatus.WINNER_WINDOW,
          prizeFinalizedAt: null,
          winnerWindowEndsAt: { lte: finalizeAfter },
        },
        data: {
          prizeFinalizedAt: new Date(),
        },
      });

      if (lockResult.count !== 1) {
        return null;
      }

      const session = await tx.gameSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          playCode: true,
          prizeAmount: true,
          gameSlotId: true,
          roundIndex: true,
          roundPrizeAmount: true,
          gameRuleId: true,
          gameSlot: {
            select: {
              id: true,
              category: true,
              forceBigGameEnabled: true,
              forceBigGameCartelaCount: true,
              roundCount: true,
              currentRound: true,
              gameRuleId: true,
              roundPrizes: true,
              roundGameRuleIds: true,
              interRoundDelaySeconds: true,
              fixedPrizeAmount: true,
            },
          },
          gameCartelas: {
            where: {
              isWinner: true,
              status: GameCartelaStatus.WINNER,
            },
            select: {
              id: true,
              userId: true,
              cartela: { select: { number: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!session || session.gameCartelas.length === 0) {
        throw new ConflictException(
          'Winner window could not be finalized without winners',
        );
      }

      const isChainGame = this.chainRoundService.isChainSlot(session.gameSlot);
      const roundIndex = session.roundIndex ?? 1;
      // Chain sessions keep `prizeAmount` as the whole-chain pool, so only the
      // current round's slice is at stake here.
      const payoutPool = isChainGame
        ? this.chainRoundService.resolveActiveRoundPrize(session)
        : session.prizeAmount;

      const prizeShares = splitPrizeAmount(
        payoutPool,
        session.gameCartelas.length,
      );

      const forceEnabled =
        session.gameSlot.forceBigGameEnabled === true &&
        canForceBigGameTickets(session.gameSlot.category);
      const forceCount = session.gameSlot.forceBigGameCartelaCount ?? 0;
      const ticketsPerWinner = resolveForceBigGameTicketsPerWinner(
        forceCount,
        session.gameCartelas.length,
      );
      const activeBigGame =
        forceEnabled && ticketsPerWinner > 0
          ? await this.bigGameTicketService.findActiveBigGameSlot(tx)
          : null;

      const ticketGrants: Array<{
        userId: string;
        ticketCount: number;
        netPrize: string;
        bigGameSlotId: string;
        bigGameName: string;
      }> = [];

      for (const [index, winner] of session.gameCartelas.entries()) {
        let creditAmount = prizeShares[index];
        const ledgerReferenceId = prizeLedgerReferenceId(winner.id, {
          isChainGame,
          roundIndex,
        });
        if (forceEnabled && activeBigGame && ticketsPerWinner > 0) {
          const forceCost = activeBigGame.entryFee.mul(ticketsPerWinner);
          const net = creditAmount.minus(forceCost);
          creditAmount = net.gt(0) ? net : new Prisma.Decimal(0);

          const grant = await this.bigGameTicketService.grantTickets(tx, {
            userId: winner.userId,
            gameSlotId: activeBigGame.slotId,
            count: ticketsPerWinner,
            type: BigGameTicketLedgerType.GRANT_FORCE,
            referenceType: 'GAME_CARTELA_FORCE',
            referenceId: ledgerReferenceId,
            description: `Force Big Tickets from prize (${session.playCode})`,
          });

          if (grant.applied) {
            ticketGrants.push({
              userId: winner.userId,
              ticketCount: ticketsPerWinner,
              netPrize: creditAmount.toString(),
              bigGameSlotId: activeBigGame.slotId,
              bigGameName: activeBigGame.slotName,
            });
          }
        }

        if (creditAmount.gt(0)) {
          await this.walletService.creditWallet(
            tx,
            winner.userId,
            creditAmount,
            {
              type: WalletTransactionType.PRIZE_WIN,
              referenceType: 'GAME_CARTELA',
              referenceId: ledgerReferenceId,
              description: isChainGame
                ? `Prize win for session ${session.playCode} round ${roundIndex}`
                : `Prize win for session ${session.playCode}`,
            },
          );
        }
      }

      const finishedAt = new Date();
      const primaryWinnerId = session.gameCartelas[0]?.id ?? null;

      // --- CHAIN_GAME round bookkeeping -------------------------------------
      // Every chain round (including the last) is recorded; only a non-final
      // round skips the FINISHED write below.
      let chainAdvance: ChainRoundAdvance | null = null;
      if (isChainGame) {
        const winningClaim = await tx.bingoClaim.findFirst({
          where: {
            gameSessionId: session.id,
            status: BingoClaimStatus.VALID,
          },
          orderBy: { checkedAt: 'desc' },
          select: { winningBallLetter: true, winningBallNumber: true },
        });

        await this.chainRoundService.recordRoundResult(tx, {
          sessionId: session.id,
          roundIndex: session.roundIndex ?? 1,
          gameRuleId: session.gameRuleId ?? session.gameSlot.gameRuleId ?? null,
          prizeAmount: payoutPool,
          outcome: ChainRoundOutcome.WON,
          winners: session.gameCartelas.map((winner, index) => ({
            gameCartelaId: winner.id,
            userId: winner.userId,
            cartelaNumber: winner.cartela?.number ?? 0,
            amount: prizeShares[index] ?? new Prisma.Decimal(0),
          })),
          winningBall:
            winningClaim?.winningBallLetter != null &&
            winningClaim.winningBallNumber != null
              ? {
                  letter: winningClaim.winningBallLetter,
                  number: winningClaim.winningBallNumber,
                }
              : null,
        });

        if (this.chainRoundService.shouldContinueAfterRound(session)) {
          await this.chainRoundService.invalidateStalePendingClaims(tx, {
            sessionId: session.id,
            roundIndex: session.roundIndex ?? 1,
          });

          chainAdvance = await this.chainRoundService.advanceToNextRound(tx, {
            sessionId: session.id,
            finishedRoundIndex: session.roundIndex ?? 1,
            slot: session.gameSlot,
            winnerCartelaIds: session.gameCartelas.map((winner) => winner.id),
            now: finishedAt,
          });

          await this.auditLogService.create(tx, {
            actorId: null,
            action: 'system.chain_round.advance',
            entity: 'GameSession',
            entityId: session.id,
            metadata: {
              finishedRoundIndex: chainAdvance.finishedRoundIndex,
              nextRoundIndex: chainAdvance.nextRoundIndex,
              winnerCount: session.gameCartelas.length,
              roundPrizeAmount: payoutPool.toString(),
              pausedUntil: chainAdvance.pausedUntil.toISOString(),
            },
          });

          // Deliberately skips restoreSlotAfterSession, the next-game opener,
          // and emitSessionFinished: the session is still live.
          return {
            sessionId: session.id,
            gameSlotId: session.gameSlotId,
            winnerUserIds: session.gameCartelas.map((winner) => winner.userId),
            openedRegistration: null,
            ticketGrants,
            nextRoundStartsAt: null,
            nextSessionId: null,
            needsBigGameHandoff: false,
            chainAdvance,
            chainRoundCount: session.gameSlot.roundCount ?? 1,
            chainRoundPrizeAmount: payoutPool.toString(),
            chainWinners: session.gameCartelas.map((winner, index) => ({
              gameCartelaId: winner.id,
              cartelaNumber: winner.cartela?.number ?? 0,
              amount: (prizeShares[index] ?? new Prisma.Decimal(0)).toString(),
            })),
          };
        }

        if (isChainDebugEnabled()) {
          this.logger.log(
            `[chain] finalize last round FINISHED session=${session.id} ` +
              `round=${session.roundIndex ?? 1}/${session.gameSlot.roundCount ?? 1} ` +
              `emit=game:finished`,
          );
        }
      }
      // ----------------------------------------------------------------------

      const finishResult = await tx.gameSession.updateMany({
        where: {
          id: sessionId,
          status: GameStatus.WINNER_WINDOW,
          prizeFinalizedAt: { not: null },
          winnerCartelaId: null,
        },
        data: {
          status: GameStatus.FINISHED,
          winnerCartelaId: primaryWinnerId,
          finishedAt,
          noWinnerGraceEndsAt: null,
          noWinnerReason: null,
        },
      });

      if (finishResult.count !== 1) {
        throw new ConflictException('Winner window already finalized');
      }

      const isBigGame = session.gameSlot.category === GameCategory.BIG_GAME;

      // Option A: finish + pay here; open/arm the next round in a separate
      // handoff transaction so clone work cannot expire this finalize tx.
      if (isBigGame) {
        await this.auditLogService.create(tx, {
          actorId: null,
          action: 'system.winner_window.finalize',
          entity: 'GameSession',
          entityId: session.id,
          metadata: {
            winnerCount: session.gameCartelas.length,
            prizeAmount: session.prizeAmount.toString(),
            ticketGrants: ticketGrants.length,
            nextRoundStartsAt: null,
            nextSessionId: null,
            deferredBigGameHandoff: true,
          },
        });

        return {
          sessionId: session.id,
          gameSlotId: session.gameSlotId,
          winnerUserIds: session.gameCartelas.map((winner) => winner.userId),
          openedRegistration: null,
          ticketGrants,
          nextRoundStartsAt: null,
          nextSessionId: null,
          needsBigGameHandoff: true,
          chainAdvance: null,
          chainRoundCount: session.gameSlot.roundCount ?? 1,
          chainRoundPrizeAmount: payoutPool.toString(),
          chainWinners: [] as Array<{
            gameCartelaId: string;
            cartelaNumber: number;
            amount: string;
          }>,
        };
      }

      await this.gameQueueService.restoreSlotAfterSession(
        tx,
        session.gameSlotId,
      );

      await this.auditLogService.create(tx, {
        actorId: null,
        action: 'system.winner_window.finalize',
        entity: 'GameSession',
        entityId: session.id,
        metadata: {
          winnerCount: session.gameCartelas.length,
          prizeAmount: session.prizeAmount.toString(),
          ticketGrants: ticketGrants.length,
          nextRoundStartsAt: null,
          nextSessionId: null,
        },
      });

      const openedRegistration =
        await this.postGameRegistrationOpenerService.openNextAutoQueueRegistrationInTransaction(
          tx,
          {
            ignoreReviewGrace: true,
          },
        );

      return {
        sessionId: session.id,
        gameSlotId: session.gameSlotId,
        winnerUserIds: session.gameCartelas.map((winner) => winner.userId),
        openedRegistration,
        ticketGrants,
        nextRoundStartsAt: null,
        nextSessionId: null,
        needsBigGameHandoff: false,
        chainAdvance: null,
        chainRoundCount: session.gameSlot.roundCount ?? 1,
        chainRoundPrizeAmount: payoutPool.toString(),
        chainWinners: [] as Array<{
          gameCartelaId: string;
          cartelaNumber: number;
          amount: string;
        }>,
      };
    },
    {
      timeout: 20_000,
      maxWait: 20_000,
    },
    );

    if (!finalized) {
      this.logger.debug(
        `Skipped winner window finalization for session ${sessionId} (already finalized or not due)`,
      );
      return null;
    }

    this.logger.log(
      `Finalized winner window for session ${finalized.sessionId} with ${finalized.winnerUserIds.length} winner(s)`,
    );

    for (const userId of finalized.winnerUserIds) {
      await this.emitWalletUpdated(userId);
    }

    for (const grant of finalized.ticketGrants) {
      void this.gamePushNotificationsService.notifyBigGameTicketGranted({
        userId: grant.userId,
        ticketCount: grant.ticketCount,
        gameName: grant.bigGameName,
        bigGameSlotId: grant.bigGameSlotId,
        netPrizeAmount: grant.netPrize,
      });
    }

    // Chain game mid-chain: the session is still live, so none of the terminal
    // finish side effects below may run.
    if (finalized.chainAdvance) {
      const advance = finalized.chainAdvance;
      if (isChainDebugEnabled()) {
        this.logger.log(
          `[chain] finalize chainAdvance session=${finalized.sessionId} ` +
            `round ${advance.finishedRoundIndex} -> ${advance.nextRoundIndex} ` +
            `pausedUntil=${advance.pausedUntil.toISOString()} autoCallEnabled=false`,
        );
      }
      this.chainRoundService.emitRoundFinished({
        sessionId: finalized.sessionId,
        slotId: finalized.gameSlotId,
        finishedRoundIndex: advance.finishedRoundIndex,
        roundCount: finalized.chainRoundCount,
        pausedUntil: advance.pausedUntil.toISOString(),
        nextRoundIndex: advance.nextRoundIndex,
        nextRoundPrizeAmount: advance.nextRoundPrizeAmount.toString(),
        roundPrizeAmount: finalized.chainRoundPrizeAmount,
        winners: finalized.chainWinners,
      });
      await this.emitChainSessionUpdated(finalized.sessionId);

      return {
        sessionId: finalized.sessionId,
        winnerUserIds: finalized.winnerUserIds,
      };
    }

    let openedRegistration = finalized.openedRegistration;
    let nextSessionId: string | null = finalized.nextSessionId;

    if (finalized.needsBigGameHandoff) {
      try {
        const handoff =
          await this.bigGameRoundService.handoffAfterRoundFinalized({
            sessionId: finalized.sessionId,
            gameSlotId: finalized.gameSlotId,
          });
        nextSessionId = handoff.nextSessionId;

        if (handoff.shouldRemoveSlot) {
          await this.prisma.$transaction(async (tx) => {
            await this.gameQueueService.restoreSlotAfterSession(
              tx,
              finalized.gameSlotId,
            );
            openedRegistration =
              await this.postGameRegistrationOpenerService.openNextAutoQueueRegistrationInTransaction(
                tx,
                { ignoreReviewGrace: true },
              );
          });
        }

        this.logger.log(
          `Big Game handoff after WW finalize session=${finalized.sessionId} ` +
            `nextSession=${handoff.nextSessionId ?? 'none'} ` +
            `nextRound=${handoff.nextRoundIndex ?? 'none'} ` +
            `shouldRemoveSlot=${handoff.shouldRemoveSlot}`,
        );
      } catch (error) {
        this.logger.error(
          `Big Game handoff failed after WW finalize for session ${finalized.sessionId}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    await this.postGameRegistrationOpenerService.finalizeOpenedRegistration(
      openedRegistration,
    );
    await this.gameEngineService.emitSessionFinished(finalized.sessionId, {
      openedNextRegistration: openedRegistration != null,
    });

    if (nextSessionId) {
      await this.bigGameRoundService.emitOpenedNextRoundSession(
        finalized.gameSlotId,
        nextSessionId,
      );
    }

    return {
      sessionId: finalized.sessionId,
      winnerUserIds: finalized.winnerUserIds,
    };
  }

  /**
   * Admin action: close the winner window immediately instead of waiting for
   * winnerWindowEndsAt. Winners are paid out right away via the normal
   * finalization path. This is the supported alternative to "cancelling" a
   * WINNER_WINDOW session.
   */
  async finalizeWinnerWindowEarly(sessionId: string, actorId: string) {
    const claimed = await this.prisma.gameSession.updateMany({
      where: {
        id: sessionId,
        status: GameStatus.WINNER_WINDOW,
        prizeFinalizedAt: null,
      },
      data: { winnerWindowEndsAt: new Date() },
    });

    if (claimed.count !== 1) {
      throw new BadRequestException('Session is not in an open winner window');
    }

    await this.auditLogService.create(this.prisma, {
      actorId,
      action: 'admin.winner_window.finalize_early',
      entity: 'GameSession',
      entityId: sessionId,
      metadata: {},
    });

    const finalized = await this.finalizeWinnerWindow(sessionId);

    return {
      success: finalized !== null,
      sessionId,
      winnerCount: finalized?.winnerUserIds.length ?? 0,
    };
  }

  async getAdminBingoClaims(paginationQuery: PaginationQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(paginationQuery);
    const [totalItems, claims] = await Promise.all([
      this.prisma.bingoClaim.count(),
      this.prisma.bingoClaim.findMany({
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip,
        take,
        select: bingoClaimSelect,
      }),
    ]);

    return {
      items: claims.map((claim) => serializeBingoClaim(claim)),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  async approveClaim(claimId: string, actorId: string) {
    const checkedAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.bingoClaim.findUnique({
        where: { id: claimId },
        select: bingoClaimSelect,
      });

      if (!claim) {
        throw new NotFoundException('Bingo claim not found');
      }

      if (claim.status !== BingoClaimStatus.PENDING) {
        throw new BadRequestException('Only pending claims can be approved');
      }

      if (
        claim.gameSession.status === GameStatus.FINISHED ||
        claim.gameSession.status === GameStatus.NO_WINNER
      ) {
        throw new BadRequestException('Game already finished');
      }

      const ruleKey =
        claim.gameSession.gameRule?.key ??
        claim.gameSession.gameSlot.gameRule?.key ??
        claim.gameSession.gameSlot.gameType;
      if (!this.gameRuleEvaluationService.isManualRule(ruleKey)) {
        throw new BadRequestException(
          'Automatic game rules finalize winners without manual approval',
        );
      }

      const cartelaUpdateResult = await tx.gameCartela.updateMany({
        where: {
          id: claim.gameCartela.id,
          status: GameCartelaStatus.REGISTERED,
          isWinner: false,
        },
        data: {
          status: GameCartelaStatus.WINNER,
          isWinner: true,
          blockedAt: null,
        },
      });

      if (cartelaUpdateResult.count !== 1) {
        throw new ConflictException('Cartela could not be finalized as winner');
      }

      const finishResult = await this.gameEngineService.finishGameWithWinner(
        tx,
        claim.gameSession.id,
        claim.gameCartela.id,
        checkedAt,
      );

      if (!finishResult.finished) {
        throw new ConflictException('Game already finished');
      }

      await this.walletService.creditWallet(
        tx,
        claim.userId,
        claim.gameSession.prizeAmount,
        {
          type: WalletTransactionType.PRIZE_WIN,
          referenceType: 'GAME_CARTELA',
          referenceId: claim.gameCartela.id,
          description: `Prize win for session ${claim.gameSession.playCode}`,
        },
      );

      const updatedClaim = await tx.bingoClaim.update({
        where: { id: claim.id },
        data: {
          status: BingoClaimStatus.VALID,
          reason: null,
          reasonCode: null,
          checkedAt,
        },
        select: bingoClaimSelect,
      });

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.bingo_claim.approve',
        entity: 'BingoClaim',
        entityId: claim.id,
        metadata: {
          sessionId: claim.gameSessionId,
          gameCartelaId: claim.gameCartelaId,
          userId: claim.userId,
        },
      });

      return {
        claim: serializeBingoClaim(updatedClaim),
        sessionId: claim.gameSession.id,
        userId: claim.userId,
        gameCartelaId: claim.gameCartela.id,
        openedRegistration: finishResult.openedRegistration,
      };
    });

    const validPayload = {
      sessionId: result.sessionId,
      userId: result.userId,
      gameCartelaId: result.gameCartelaId,
      claimId: result.claim.id,
      matchedPattern: result.claim.checkedPattern,
      progress: null,
      completedPatterns: [],
    };

    this.realtimeService.emitToGame(
      result.sessionId,
      'game:bingo_valid',
      validPayload,
    );
    this.realtimeService.emitToAdmin('game:bingo_valid', validPayload);
    this.realtimeService.emitToUser(
      result.userId,
      'game:bingo_valid',
      validPayload,
    );

    await this.postGameRegistrationOpenerService.finalizeOpenedRegistration(
      result.openedRegistration,
    );
    await this.gameEngineService.emitSessionFinished(result.sessionId, {
      openedNextRegistration: result.openedRegistration != null,
    });

    await this.emitWalletUpdated(result.userId);

    return result.claim;
  }

  async rejectClaim(
    claimId: string,
    rejectBingoClaimDto: RejectBingoClaimDto,
    actorId: string,
  ) {
    const checkedAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.bingoClaim.findUnique({
        where: { id: claimId },
        select: bingoClaimSelect,
      });

      if (!claim) {
        throw new NotFoundException('Bingo claim not found');
      }

      if (claim.status !== BingoClaimStatus.PENDING) {
        throw new BadRequestException('Only pending claims can be rejected');
      }

      const ruleKey =
        claim.gameSession.gameRule?.key ??
        claim.gameSession.gameSlot.gameRule?.key ??
        claim.gameSession.gameSlot.gameType;
      if (!this.gameRuleEvaluationService.isManualRule(ruleKey)) {
        throw new BadRequestException(
          'Automatic game rules reject invalid claims immediately on submit',
        );
      }

      const cartelaUpdateResult = await tx.gameCartela.updateMany({
        where: {
          id: claim.gameCartela.id,
          status: GameCartelaStatus.REGISTERED,
        },
        data: {
          status: GameCartelaStatus.BLOCKED,
          blockedAt: checkedAt,
        },
      });

      if (cartelaUpdateResult.count !== 1) {
        throw new ConflictException('Cartela could not be blocked');
      }

      const calledNumbers = await tx.calledNumber.findMany({
        where: { gameSessionId: claim.gameSessionId },
        orderBy: { order: 'asc' },
        select: calledNumberEvaluationSelect,
      });
      const activeBall =
        resolveWinningBallFromCalledNumbersSnapshot(calledNumbers);

      const updatedClaim = await tx.bingoClaim.update({
        where: { id: claim.id },
        data: {
          status: BingoClaimStatus.INVALID,
          reason:
            rejectBingoClaimDto.reason?.trim() ||
            'Rejected after manual admin review',
          reasonCode: null,
          checkedAt,
          winningBallLetter: activeBall?.letter ?? null,
          winningBallNumber: activeBall?.number ?? null,
        },
        select: bingoClaimSelect,
      });

      await tx.gameSession.update({
        where: { id: claim.gameSessionId },
        data: { status: GameStatus.PLAYING },
      });

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.bingo_claim.reject',
        entity: 'BingoClaim',
        entityId: claim.id,
        metadata: {
          sessionId: claim.gameSessionId,
          gameCartelaId: claim.gameCartelaId,
          userId: claim.userId,
        },
      });

      return {
        claim: serializeBingoClaim(updatedClaim),
        sessionId: claim.gameSessionId,
        userId: claim.userId,
        gameCartelaId: claim.gameCartelaId,
      };
    });

    const invalidPayload = {
      sessionId: result.sessionId,
      userId: result.userId,
      gameCartelaId: result.gameCartelaId,
      claimId: result.claim.id,
      matchedPattern: result.claim.checkedPattern,
      reason: result.claim.reason,
      reasonCode: result.claim.reasonCode,
      progress: null,
    };

    this.realtimeService.emitToGame(
      result.sessionId,
      'game:bingo_invalid',
      invalidPayload,
    );
    this.realtimeService.emitToAdmin('game:bingo_invalid', invalidPayload);
    this.realtimeService.emitToUser(
      result.userId,
      'game:bingo_invalid',
      invalidPayload,
    );

    const updatedSession = await this.prisma.gameSession.findUnique({
      where: { id: result.sessionId },
      select: gameSessionSelect,
    });

    if (updatedSession) {
      await this.emitSessionStatusChanged(updatedSession);
    }

    return result.claim;
  }

  private async acceptClaimAttempt(
    tx: Prisma.TransactionClient,
    args: {
      sessionId: string;
      userId: string;
      gameCartelaId: string;
      claimAttemptId: string;
      clientTapAt: Date | null;
      requestId: string;
    },
  ): Promise<AcceptClaimResult> {
    const gameCartela = await this.loadClaimCartela(
      tx,
      args.sessionId,
      args.userId,
      args.gameCartelaId,
    );

    const openChecking = await tx.bingoClaim.findFirst({
      where: {
        gameCartelaId: args.gameCartelaId,
        status: BingoClaimStatus.CHECKING,
      },
      select: createdPlayerBingoClaimSelect,
    });
    if (openChecking && openChecking.claimAttemptId !== args.claimAttemptId) {
      throw new ConflictException(
        'A bingo claim is already being checked for this cartela',
      );
    }

    const terminalReasonCode = this.getTerminalClaimReasonCode(gameCartela);
    if (terminalReasonCode) {
      const sideEffect = await this.createAlreadyResolvedClaimResponse(
        tx,
        gameCartela,
        args.userId,
        terminalReasonCode,
        {
          claimAttemptId: args.claimAttemptId,
          clientTapAt: args.clientTapAt,
          requestId: args.requestId,
        },
      );
      return { kind: 'already_resolved', sideEffect };
    }

    const ruleKey = this.resolveRuleKey(gameCartela);
    const attemptNumber =
      (await tx.bingoClaim.count({
        where: { gameCartelaId: args.gameCartelaId },
      })) + 1;

    const latestCalled = await tx.calledNumber.findFirst({
      where: { gameSessionId: args.sessionId },
      orderBy: { order: 'desc' },
      select: { letter: true, number: true, order: true },
    });
    const calledNumbersCountAtReceipt = await tx.calledNumber.count({
      where: { gameSessionId: args.sessionId },
    });

    if (this.gameRuleEvaluationService.isManualRule(ruleKey)) {
      const sideEffect = await this.createManualPendingClaim(
        tx,
        gameCartela,
        args.userId,
        ruleKey,
        {
          claimAttemptId: args.claimAttemptId,
          attemptNumber,
          clientTapAt: args.clientTapAt,
          requestId: args.requestId,
          receiptBallLetter: latestCalled?.letter ?? null,
          receiptBallNumber: latestCalled?.number ?? null,
          receiptCalledOrder: latestCalled?.order ?? null,
          calledNumbersCountAtReceipt,
        },
      );
      return { kind: 'manual_pending', sideEffect };
    }

    this.assertClaimableCartela(gameCartela);
    const sessionStatus = gameCartela.gameSession.status;
    if (
      sessionStatus !== GameStatus.PLAYING &&
      sessionStatus !== GameStatus.WINNER_WINDOW
    ) {
      throw new BadRequestException(
        'Game must be PLAYING or in the winner window to claim bingo',
      );
    }

    let pausedRemainingMs = 0;
    let hadScheduledAutoCall = false;
    if (
      sessionStatus === GameStatus.PLAYING &&
      gameCartela.gameSession.autoCallEnabled
    ) {
      const scheduledAt = gameCartela.gameSession.nextAutoCallAt;
      hadScheduledAutoCall = scheduledAt != null;
      const nowMs = Date.now();
      pausedRemainingMs =
        scheduledAt && scheduledAt.getTime() > nowMs
          ? scheduledAt.getTime() - nowMs
          : 0;

      await tx.gameSession.updateMany({
        where: {
          id: gameCartela.gameSessionId,
          status: GameStatus.PLAYING,
          autoCallEnabled: true,
        },
        data: { nextAutoCallAt: null },
      });
      gameCartela.gameSession.nextAutoCallAt = null;
    }

    const receivedAt = new Date();
    const claim = await tx.bingoClaim.create({
      data: {
        claimAttemptId: args.claimAttemptId,
        gameSessionId: gameCartela.gameSessionId,
        userId: args.userId,
        gameCartelaId: gameCartela.id,
        status: BingoClaimStatus.CHECKING,
        attemptNumber,
        checkedPattern: ruleKey,
        receivedAt,
        requestId: args.requestId,
        clientTapAt: args.clientTapAt,
        receiptBallLetter: latestCalled?.letter ?? null,
        receiptBallNumber: latestCalled?.number ?? null,
        receiptCalledOrder: latestCalled?.order ?? null,
        calledNumbersCountAtReceipt,
      },
      select: createdPlayerBingoClaimSelect,
    });

    return {
      kind: 'auto_checking',
      claimId: claim.id,
      claimAttemptId: claim.claimAttemptId,
      attemptNumber: claim.attemptNumber,
      receivedAt: claim.receivedAt,
      gameCartela,
      ruleKey,
      pausedRemainingMs,
      hadScheduledAutoCall,
      cartelaNumber: gameCartela.cartela.number,
    };
  }

  private async buildIdempotentClaimResponse(
    claim: CreatedPlayerBingoClaimRecord,
  ) {
    const gameCartela = await this.prisma.gameCartela.findUnique({
      where: { id: claim.gameCartelaId },
      select: {
        status: true,
        isWinner: true,
        gameSession: {
          select: {
            status: true,
            nextAutoCallAt: true,
            winnerWindowEndsAt: true,
          },
        },
      },
    });

    const gameStatus =
      gameCartela?.gameSession.status ?? GameStatus.PLAYING;
    const gameCartelaStatus =
      gameCartela?.status ?? GameCartelaStatus.REGISTERED;
    const isWinner =
      claim.status === BingoClaimStatus.VALID ||
      gameCartela?.isWinner === true;
    const retryAllowed = claim.status === BingoClaimStatus.FAILED;

    return {
      claim: serializePlayerBingoClaim(claim),
      progress: null,
      isWinner,
      gameStatus,
      gameCartelaStatus,
      reasonCode: claim.reasonCode,
      failureCode: claim.failureCode,
      retryAllowed,
      nextAutoCallAt:
        gameCartela?.gameSession.nextAutoCallAt?.toISOString() ?? null,
      ...(gameCartela?.gameSession.winnerWindowEndsAt
        ? {
            winnerWindowEndsAt:
              gameCartela.gameSession.winnerWindowEndsAt.toISOString(),
          }
        : {}),
    };
  }

  private async finalizeFailedClaimAttempt(args: {
    claimId: string;
    claimAttemptId: string;
    sessionId: string;
    userId: string;
    gameCartelaId: string;
    cartelaNumber: number;
    slotId: string;
    gameStatus: GameStatus;
    receivedAt: Date;
    pausedRemainingMs: number;
    hadScheduledAutoCall: boolean;
    autoCallEnabled: boolean;
    autoCallIntervalMs: number | null;
    error: unknown;
  }): Promise<ClaimSideEffectResult> {
    const failureCode = this.mapInfraFailureCode(args.error);
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - args.receivedAt.getTime();
    const defaultAutoCallIntervalMs =
      await this.gameTimingConfigService.getAutoCallIntervalMs();

    const restoredNextAutoCallAt =
      args.autoCallEnabled && args.gameStatus === GameStatus.PLAYING
        ? this.computeInvalidClaimResumeAt(
            args.pausedRemainingMs,
            args.hadScheduledAutoCall,
            defaultAutoCallIntervalMs,
            args.autoCallIntervalMs,
          )
        : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimUpdate = await tx.bingoClaim.updateMany({
        where: {
          id: args.claimId,
          status: BingoClaimStatus.CHECKING,
        },
        data: {
          status: BingoClaimStatus.FAILED,
          failureCode,
          failureMessage: 'Claim could not be completed. You may try again.',
          reason: 'Claim could not be completed. You may try again.',
          completedAt,
          durationMs,
          checkedAt: completedAt,
        },
      });

      if (claimUpdate.count !== 1) {
        const existing = await tx.bingoClaim.findUnique({
          where: { id: args.claimId },
          select: createdPlayerBingoClaimSelect,
        });
        if (existing && existing.status !== BingoClaimStatus.CHECKING) {
          return existing;
        }
        throw new ConflictException('Claim attempt could not be marked failed');
      }

      if (restoredNextAutoCallAt) {
        await tx.gameSession.updateMany({
          where: {
            id: args.sessionId,
            status: GameStatus.PLAYING,
            autoCallEnabled: true,
          },
          data: { nextAutoCallAt: restoredNextAutoCallAt },
        });
      }

      return tx.bingoClaim.findUniqueOrThrow({
        where: { id: args.claimId },
        select: createdPlayerBingoClaimSelect,
      });
    });

    const serializedClaim = serializePlayerBingoClaim(updated);
    this.logBingoClaimStage({
      claimAttemptId: args.claimAttemptId,
      sessionId: args.sessionId,
      gameCartelaId: args.gameCartelaId,
      userId: args.userId,
      attemptNumber: updated.attemptNumber,
      stage: 'failed',
      durationMs,
      failureCode,
      result: 'FAILED',
    });

    return {
      kind: 'auto_failed',
      sessionId: args.sessionId,
      slotId: args.slotId,
      gameStatus: args.gameStatus,
      userId: args.userId,
      gameCartelaId: args.gameCartelaId,
      cartelaNumber: args.cartelaNumber,
      claim: serializedClaim,
      retryAllowed: true,
      leanAutoCall: {
        autoCallEnabled: args.autoCallEnabled,
        autoCallIntervalMs: args.autoCallIntervalMs,
        nextAutoCallAt: restoredNextAutoCallAt?.toISOString() ?? null,
      },
      sessionStatusBefore: args.gameStatus,
      cartelaStatusBefore: GameCartelaStatus.REGISTERED,
      response: {
        claim: serializedClaim,
        progress: null,
        isWinner: false,
        gameStatus: args.gameStatus,
        gameCartelaStatus: GameCartelaStatus.REGISTERED,
        reasonCode: null,
        failureCode,
        retryAllowed: true,
        nextAutoCallAt: restoredNextAutoCallAt?.toISOString() ?? null,
      },
    };
  }

  private mapInfraFailureCode(error: unknown): BingoClaimFailureCode {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2028'
    ) {
      return 'DB_TRANSACTION_TIMEOUT';
    }
    if (isPrismaConnectivityError(error)) {
      return 'DB_UNAVAILABLE';
    }
    if (error instanceof ConflictException) {
      return 'CLAIM_STATE_CONFLICT';
    }
    return 'VALIDATION_INTERNAL_ERROR';
  }

  private logBingoClaimStage(fields: {
    claimAttemptId: string;
    sessionId: string;
    gameCartelaId: string;
    userId: string;
    attemptNumber?: number;
    stage: string;
    latestCalledNumber?: string;
    latestCalledOrder?: number;
    durationMs?: number;
    result?: string;
    failureCode?: string;
  }) {
    this.logger.log(
      `[bingo_claim] claimAttemptId=${fields.claimAttemptId} requestId=${this.requestContext.getRequestIdForLog()} sessionId=${fields.sessionId} gameCartelaId=${fields.gameCartelaId} userId=${fields.userId} attemptNumber=${fields.attemptNumber ?? '-'} stage=${fields.stage} latestCalledNumber=${fields.latestCalledNumber ?? '-'} latestCalledOrder=${fields.latestCalledOrder ?? '-'} durationMs=${fields.durationMs ?? '-'} result=${fields.result ?? '-'} failureCode=${fields.failureCode ?? '-'}`,
    );
  }

  private async loadClaimCartela(
    tx: Prisma.TransactionClient,
    sessionId: string,
    userId: string,
    gameCartelaId: string,
  ): Promise<ClaimCartelaRecord> {
    const gameCartela = await tx.gameCartela.findFirst({
      where: {
        id: gameCartelaId,
        gameSessionId: sessionId,
        userId,
      },
      select: {
        id: true,
        gameSessionId: true,
        userId: true,
        status: true,
        isWinner: true,
        cartela: {
          select: {
            id: true,
            number: true,
            b: true,
            i: true,
            n: true,
            g: true,
            o: true,
          },
        },
        gameSession: {
          select: {
            id: true,
            playCode: true,
            status: true,
            prizeAmount: true,
            autoCallEnabled: true,
            autoCallIntervalMs: true,
            nextAutoCallAt: true,
            winnerWindowEndsAt: true,
            gameRule: {
              select: {
                id: true,
                key: true,
                name: true,
                patterns: true,
              },
            },
            gameSlot: {
              select: {
                id: true,
                gameType: true,
                gameRule: {
                  select: {
                    id: true,
                    key: true,
                    name: true,
                    patterns: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!gameCartela) {
      throw new NotFoundException('Game cartela not found');
    }

    return gameCartela;
  }

  private assertClaimableCartela(gameCartela: ClaimCartelaRecord) {
    if (gameCartela.status !== GameCartelaStatus.REGISTERED) {
      throw new BadRequestException('This cartela cannot make a bingo claim');
    }

    if (
      gameCartela.gameSession.status === GameStatus.FINISHED ||
      gameCartela.gameSession.status === GameStatus.NO_WINNER
    ) {
      throw new BadRequestException('Game already finished');
    }
  }

  private resolveRuleKey(gameCartela: ClaimCartelaRecord): string {
    return resolveSessionGameRuleKey({
      sessionGameRuleKey: gameCartela.gameSession.gameRule?.key,
      slotGameRuleKey: gameCartela.gameSession.gameSlot.gameRule?.key,
      slotGameType: gameCartela.gameSession.gameSlot.gameType,
    });
  }

  private resolveClaimGameRule(gameCartela: ClaimCartelaRecord) {
    return resolveSessionGameRule({
      sessionGameRule: gameCartela.gameSession.gameRule,
      slotGameRule: gameCartela.gameSession.gameSlot.gameRule,
    });
  }

  private getTerminalClaimReasonCode(
    gameCartela: ClaimCartelaRecord,
  ): Extract<
    BingoClaimReasonCode,
    'ALREADY_BLOCKED' | 'ALREADY_WINNER'
  > | null {
    if (gameCartela.status === GameCartelaStatus.BLOCKED) {
      return 'ALREADY_BLOCKED';
    }

    if (
      gameCartela.status === GameCartelaStatus.WINNER ||
      gameCartela.isWinner
    ) {
      return 'ALREADY_WINNER';
    }

    return null;
  }

  private async createAlreadyResolvedClaimResponse(
    tx: Prisma.TransactionClient,
    gameCartela: ClaimCartelaRecord,
    userId: string,
    reasonCode: Extract<
      BingoClaimReasonCode,
      'ALREADY_BLOCKED' | 'ALREADY_WINNER'
    >,
    attempt: {
      claimAttemptId: string;
      clientTapAt: Date | null;
      requestId: string;
    },
  ) {
    const existingClaim = await tx.bingoClaim.findFirst({
      where: {
        gameSessionId: gameCartela.gameSessionId,
        gameCartelaId: gameCartela.id,
        ...(reasonCode === 'ALREADY_WINNER'
          ? { status: BingoClaimStatus.VALID }
          : { status: { in: finalClaimStatuses } }),
      },
      orderBy: [{ checkedAt: 'desc' }, { createdAt: 'desc' }],
      select: createdPlayerBingoClaimSelect,
    });

    const receivedAt = new Date();
    const attemptNumber =
      (await tx.bingoClaim.count({
        where: { gameCartelaId: gameCartela.id },
      })) + 1;

    const claim =
      existingClaim?.claimAttemptId === attempt.claimAttemptId
        ? existingClaim
        : await tx.bingoClaim.create({
            data: {
              claimAttemptId: attempt.claimAttemptId,
              gameSessionId: gameCartela.gameSessionId,
              userId,
              gameCartelaId: gameCartela.id,
              status: BingoClaimStatus.ALREADY_RESOLVED,
              attemptNumber,
              checkedPattern: this.resolveRuleKey(gameCartela),
              reason: TERMINAL_CLAIM_REASONS[reasonCode],
              reasonCode,
              receivedAt,
              completedAt: receivedAt,
              durationMs: 0,
              checkedAt: receivedAt,
              requestId: attempt.requestId,
              clientTapAt: attempt.clientTapAt,
            },
            select: createdPlayerBingoClaimSelect,
          });

    const serializedClaim = serializePlayerBingoClaim(claim, { reasonCode });

    return {
      kind: 'already_resolved' as const,
      sessionId: gameCartela.gameSessionId,
      slotId: gameCartela.gameSession.gameSlot.id,
      gameStatus: gameCartela.gameSession.status,
      userId,
      gameCartelaId: gameCartela.id,
      cartelaNumber: gameCartela.cartela.number,
      claim: serializedClaim,
      sessionStatusBefore: gameCartela.gameSession.status,
      cartelaStatusBefore: gameCartela.status,
      response: {
        claim: serializedClaim,
        progress: null,
        isWinner: reasonCode === 'ALREADY_WINNER',
        gameStatus: gameCartela.gameSession.status,
        gameCartelaStatus: gameCartela.status,
        retryAllowed: false,
        ...(gameCartela.gameSession.winnerWindowEndsAt
          ? {
              winnerWindowEndsAt:
                gameCartela.gameSession.winnerWindowEndsAt.toISOString(),
            }
          : {}),
        reasonCode,
      },
    };
  }

  private async createManualPendingClaim(
    tx: Prisma.TransactionClient,
    gameCartela: ClaimCartelaRecord,
    userId: string,
    ruleKey: string,
    attempt: {
      claimAttemptId: string;
      attemptNumber: number;
      clientTapAt: Date | null;
      requestId: string;
      receiptBallLetter: string | null;
      receiptBallNumber: number | null;
      receiptCalledOrder: number | null;
      calledNumbersCountAtReceipt: number;
    },
  ) {
    this.assertClaimableCartela(gameCartela);

    if (gameCartela.gameSession.status !== GameStatus.PLAYING) {
      throw new BadRequestException('Game must be PLAYING to claim bingo');
    }

    const sessionStatusBefore = gameCartela.gameSession.status;
    const cartelaStatusBefore = gameCartela.status;

    const existingPendingClaim = await tx.bingoClaim.findFirst({
      where: {
        gameSessionId: gameCartela.gameSessionId,
        gameCartelaId: gameCartela.id,
        status: BingoClaimStatus.PENDING,
      },
      select: { id: true },
    });

    if (existingPendingClaim) {
      throw new BadRequestException(
        'A bingo claim for this cartela is already pending review',
      );
    }

    const receivedAt = new Date();
    const claim = await tx.bingoClaim.create({
      data: {
        claimAttemptId: attempt.claimAttemptId,
        gameSessionId: gameCartela.gameSessionId,
        userId,
        gameCartelaId: gameCartela.id,
        status: BingoClaimStatus.PENDING,
        attemptNumber: attempt.attemptNumber,
        checkedPattern: ruleKey,
        reason: 'Waiting for admin confirmation',
        reasonCode: null,
        receivedAt,
        requestId: attempt.requestId,
        clientTapAt: attempt.clientTapAt,
        receiptBallLetter: attempt.receiptBallLetter,
        receiptBallNumber: attempt.receiptBallNumber,
        receiptCalledOrder: attempt.receiptCalledOrder,
        calledNumbersCountAtReceipt: attempt.calledNumbersCountAtReceipt,
      },
      select: createdPlayerBingoClaimSelect,
    });

    await tx.gameSession.update({
      where: { id: gameCartela.gameSessionId },
      data: {
        status: GameStatus.CHECKING,
        autoCallEnabled: false,
        nextAutoCallAt: null,
      },
    });

    await this.auditLogService.create(tx, {
      actorId: userId,
      action: 'player.bingo.pending',
      entity: 'BingoClaim',
      entityId: claim.id,
      metadata: {
        sessionId: gameCartela.gameSessionId,
        gameCartelaId: gameCartela.id,
        gameRuleKey: ruleKey,
        claimAttemptId: attempt.claimAttemptId,
      },
    });

    const serializedClaim = serializePlayerBingoClaim(claim);

    return {
      kind: 'manual_pending' as const,
      sessionId: gameCartela.gameSessionId,
      slotId: gameCartela.gameSession.gameSlot.id,
      gameStatus: GameStatus.CHECKING,
      userId,
      gameCartelaId: gameCartela.id,
      cartelaNumber: gameCartela.cartela.number,
      claim: serializedClaim,
      sessionStatusBefore,
      cartelaStatusBefore,
      leanAutoCall: {
        autoCallEnabled: false,
        autoCallIntervalMs: gameCartela.gameSession.autoCallIntervalMs,
        nextAutoCallAt: null,
      },
      response: {
        claim: serializedClaim,
        progress: null,
        isWinner: false,
        gameStatus: GameStatus.CHECKING,
        gameCartelaStatus: GameCartelaStatus.REGISTERED,
        reasonCode: null,
        retryAllowed: false,
        nextAutoCallAt: null,
      },
    };
  }

  private async createAutoValidatedClaim(
    tx: Prisma.TransactionClient,
    gameCartela: ClaimCartelaRecord,
    userId: string,
    ruleKey: string,
    attempt: {
      existingClaimId: string;
      claimAttemptId: string;
      receivedAt: Date;
      pausedRemainingMs: number;
      hadScheduledAutoCall: boolean;
      autoCallAlreadyPaused: boolean;
    },
  ) {
    this.assertClaimableCartela(gameCartela);

    const sessionStatus = gameCartela.gameSession.status;
    if (
      sessionStatus !== GameStatus.PLAYING &&
      sessionStatus !== GameStatus.WINNER_WINDOW
    ) {
      throw new BadRequestException(
        'Game must be PLAYING or in the winner window to claim bingo',
      );
    }

    // Auto-call pause happens in accept txn; validation reuses remaining ms.
    const pausedRemainingMs = attempt.pausedRemainingMs;
    const hadScheduledAutoCall = attempt.hadScheduledAutoCall;

    const [
      defaultAutoCallIntervalMs,
      winnerWindowDurationMs,
      winnerWindowClaimGraceMs,
    ] = await Promise.all([
      this.gameTimingConfigService.getAutoCallIntervalMs(),
      this.gameTimingConfigService.getWinnerWindowDurationMs(),
      this.gameTimingConfigService.getWinnerWindowClaimGraceMs(),
    ]);

    const calledNumbers = await tx.calledNumber.findMany({
      where: { gameSessionId: gameCartela.gameSessionId },
      orderBy: { order: 'asc' },
      select: calledNumberEvaluationSelect,
    });

    const evaluation = this.gameRuleEvaluationService.evaluate(
      {
        id: gameCartela.cartela.id,
        number: gameCartela.cartela.number,
        b: gameCartela.cartela.b,
        i: gameCartela.cartela.i,
        n: gameCartela.cartela.n,
        g: gameCartela.cartela.g,
        o: gameCartela.cartela.o,
      },
      calledNumbers,
      ruleKey,
      this.resolveClaimGameRule(gameCartela)?.patterns,
    );

    const activeBall =
      resolveWinningBallFromCalledNumbersSnapshot(calledNumbers);

    if (!evaluation.isWinner) {
      return this.createAutoInvalidClaim(
        tx,
        gameCartela,
        userId,
        ruleKey,
        'INVALID_PATTERN',
        evaluation.matchedPattern,
        defaultAutoCallIntervalMs,
        pausedRemainingMs,
        hadScheduledAutoCall,
        activeBall,
        attempt,
      );
    }

    if (!evaluation.completedByLatestNumber) {
      return this.createAutoInvalidClaim(
        tx,
        gameCartela,
        userId,
        ruleKey,
        'INVALID_LATE_CLAIM',
        evaluation.matchedPattern,
        defaultAutoCallIntervalMs,
        pausedRemainingMs,
        hadScheduledAutoCall,
        activeBall,
        attempt,
      );
    }

    const completedPatterns = this.serializeCartelaCompletedPatterns(
      gameCartela,
      evaluation.completedPatterns,
    );
    const winningBall = activeBall;

    if (sessionStatus === GameStatus.WINNER_WINDOW) {
      return this.createAutoValidJoinWindowClaim(
        tx,
        gameCartela,
        userId,
        evaluation.matchedPattern,
        completedPatterns,
        winnerWindowClaimGraceMs,
        winningBall,
        attempt,
      );
    }

    return this.createAutoValidOpenOrJoinWindowClaim(
      tx,
      gameCartela,
      userId,
      ruleKey,
      evaluation.matchedPattern,
      evaluation.progress,
      winnerWindowDurationMs,
      completedPatterns,
      winnerWindowClaimGraceMs,
      winningBall,
      attempt,
    );
  }

  private serializeCartelaCompletedPatterns(
    gameCartela: ClaimCartelaRecord,
    patterns: CompletedPattern[],
  ): SerializedCompletedPattern[] {
    return serializeCompletedPatterns(patterns, {
      id: gameCartela.cartela.id,
      number: gameCartela.cartela.number,
      b: gameCartela.cartela.b,
      i: gameCartela.cartela.i,
      n: gameCartela.cartela.n,
      g: gameCartela.cartela.g,
      o: gameCartela.cartela.o,
    });
  }

  private computeInvalidClaimResumeAt(
    pausedRemainingMs: number,
    hadScheduledAutoCall: boolean,
    defaultAutoCallIntervalMs: number,
    autoCallIntervalMs: number | null,
  ): Date {
    if (pausedRemainingMs > 0) {
      return new Date(Date.now() + pausedRemainingMs);
    }

    if (hadScheduledAutoCall) {
      return new Date();
    }

    return new Date(
      Date.now() + (autoCallIntervalMs ?? defaultAutoCallIntervalMs),
    );
  }


  private async completeCheckingClaim(
    tx: Prisma.TransactionClient,
    attempt: {
      existingClaimId: string;
      receivedAt: Date;
    },
    data: {
      status: BingoClaimStatus;
      checkedPattern: string;
      reason: string | null;
      reasonCode: BingoClaimReasonCode | null;
      checkedAt: Date;
      winningBallLetter: string | null;
      winningBallNumber: number | null;
    },
  ): Promise<CreatedPlayerBingoClaimRecord> {
    const durationMs = data.checkedAt.getTime() - attempt.receivedAt.getTime();
    const updateResult = await tx.bingoClaim.updateMany({
      where: {
        id: attempt.existingClaimId,
        status: BingoClaimStatus.CHECKING,
      },
      data: {
        status: data.status,
        checkedPattern: data.checkedPattern,
        reason: data.reason,
        reasonCode: data.reasonCode,
        checkedAt: data.checkedAt,
        completedAt: data.checkedAt,
        durationMs,
        winningBallLetter: data.winningBallLetter,
        winningBallNumber: data.winningBallNumber,
      },
    });

    if (updateResult.count !== 1) {
      throw new ConflictException('Claim attempt could not be finalized');
    }

    return tx.bingoClaim.findUniqueOrThrow({
      where: { id: attempt.existingClaimId },
      select: createdPlayerBingoClaimSelect,
    });
  }

  private async createAutoInvalidClaim(
    tx: Prisma.TransactionClient,
    gameCartela: ClaimCartelaRecord,
    userId: string,
    ruleKey: string,
    reasonCode: Extract<
      BingoClaimReasonCode,
      'INVALID_PATTERN' | 'INVALID_LATE_CLAIM'
    >,
    matchedPattern: string,
    defaultAutoCallIntervalMs: number,
    pausedRemainingMs: number,
    hadScheduledAutoCall: boolean,
    activeBall: WinningBallRecord | null,
    attempt: {
      existingClaimId: string;
      claimAttemptId: string;
      receivedAt: Date;
    },
  ) {
    const checkedAt = new Date();
    const reason = AUTO_INVALID_REASONS[reasonCode];

    const cartelaUpdateResult = await tx.gameCartela.updateMany({
      where: {
        id: gameCartela.id,
        status: GameCartelaStatus.REGISTERED,
      },
      data: {
        status: GameCartelaStatus.BLOCKED,
        blockedAt: checkedAt,
      },
    });

    if (cartelaUpdateResult.count !== 1) {
      throw new ConflictException('Cartela could not be blocked');
    }

    const claim = await this.completeCheckingClaim(tx, attempt, {
      status: BingoClaimStatus.INVALID,
      checkedPattern: matchedPattern || ruleKey,
      reason,
      reasonCode,
      checkedAt,
      winningBallLetter: activeBall?.letter ?? null,
      winningBallNumber: activeBall?.number ?? null,
    });

    await this.auditLogService.create(tx, {
      actorId: userId,
      action: 'player.bingo.invalid',
      entity: 'BingoClaim',
      entityId: claim.id,
      metadata: {
        sessionId: gameCartela.gameSessionId,
        gameCartelaId: gameCartela.id,
        gameRuleKey: ruleKey,
        matchedPattern,
        reasonCode,
        claimAttemptId: attempt.claimAttemptId,
      },
    });

    // Restore the paused auto-call countdown so the next ball waits the
    // same remaining time (or draws immediately when already due).
    const restoredNextAutoCallAt =
      gameCartela.gameSession.autoCallEnabled &&
      gameCartela.gameSession.status === GameStatus.PLAYING
        ? this.computeInvalidClaimResumeAt(
            pausedRemainingMs,
            hadScheduledAutoCall,
            defaultAutoCallIntervalMs,
            gameCartela.gameSession.autoCallIntervalMs,
          )
        : null;

    if (restoredNextAutoCallAt) {
      await tx.gameSession.updateMany({
        where: {
          id: gameCartela.gameSessionId,
          status: GameStatus.PLAYING,
          autoCallEnabled: true,
        },
        data: {
          nextAutoCallAt: restoredNextAutoCallAt,
        },
      });
    }

    const serializedClaim = serializePlayerBingoClaim(claim, { reasonCode });

    return {
      kind: 'auto_invalid' as const,
      sessionId: gameCartela.gameSessionId,
      slotId: gameCartela.gameSession.gameSlot.id,
      gameStatus: gameCartela.gameSession.status,
      userId,
      gameCartelaId: gameCartela.id,
      cartelaNumber: gameCartela.cartela.number,
      claim: serializedClaim,
      sessionStatusBefore: gameCartela.gameSession.status,
      cartelaStatusBefore: gameCartela.status,
      leanAutoCall: {
        autoCallEnabled: gameCartela.gameSession.autoCallEnabled,
        autoCallIntervalMs: gameCartela.gameSession.autoCallIntervalMs,
        nextAutoCallAt: restoredNextAutoCallAt?.toISOString() ?? null,
      },
      response: {
        claim: serializedClaim,
        progress: null,
        isWinner: false,
        gameStatus: gameCartela.gameSession.status,
        gameCartelaStatus: GameCartelaStatus.BLOCKED,
        reasonCode,
        retryAllowed: false,
        nextAutoCallAt: restoredNextAutoCallAt?.toISOString() ?? null,
      },
    };
  }

  private async createAutoValidOpenOrJoinWindowClaim(
    tx: Prisma.TransactionClient,
    gameCartela: ClaimCartelaRecord,
    userId: string,
    ruleKey: string,
    matchedPattern: string,
    progress: number,
    winnerWindowDurationMs: number,
    completedPatterns: SerializedCompletedPattern[],
    winnerWindowClaimGraceMs: number,
    winningBall: WinningBallRecord | null,
    attempt: {
      existingClaimId: string;
      claimAttemptId: string;
      receivedAt: Date;
    },
  ) {
    const checkedAt = new Date();
    const winnerWindowStartedAt = checkedAt;
    const proposedWindowEndsAt = new Date(
      checkedAt.getTime() + winnerWindowDurationMs,
    );

    const sessionOpenResult = await tx.gameSession.updateMany({
      where: {
        id: gameCartela.gameSessionId,
        status: GameStatus.PLAYING,
      },
      data: {
        status: GameStatus.WINNER_WINDOW,
        winnerWindowStartedAt,
        winnerWindowEndsAt: proposedWindowEndsAt,
        autoCallEnabled: false,
        nextAutoCallAt: null,
        noWinnerGraceEndsAt: null,
        noWinnerReason: null,
      },
    });

    if (sessionOpenResult.count === 0) {
      const activeSession = await tx.gameSession.findUnique({
        where: { id: gameCartela.gameSessionId },
        select: {
          status: true,
          winnerWindowEndsAt: true,
        },
      });

      if (
        activeSession?.status !== GameStatus.WINNER_WINDOW ||
        !activeSession.winnerWindowEndsAt
      ) {
        throw new ConflictException('Winner window could not be opened');
      }

      this.logger.warn(
        `Winner window already open for session ${gameCartela.gameSessionId}; joining existing window for cartela ${gameCartela.id}`,
      );

      gameCartela.gameSession.status = GameStatus.WINNER_WINDOW;
      gameCartela.gameSession.winnerWindowEndsAt =
        activeSession.winnerWindowEndsAt;

      return this.createAutoValidJoinWindowClaim(
        tx,
        gameCartela,
        userId,
        matchedPattern,
        completedPatterns,
        winnerWindowClaimGraceMs,
        winningBall,
        attempt,
      );
    }

    const cartelaUpdateResult = await tx.gameCartela.updateMany({
      where: {
        id: gameCartela.id,
        status: GameCartelaStatus.REGISTERED,
        isWinner: false,
      },
      data: {
        status: GameCartelaStatus.WINNER,
        isWinner: true,
        blockedAt: null,
      },
    });

    if (cartelaUpdateResult.count !== 1) {
      throw new ConflictException('Cartela could not be marked as winner');
    }

    const claim = await this.completeCheckingClaim(tx, attempt, {
      status: BingoClaimStatus.VALID,
      checkedPattern: matchedPattern,
      reason: null,
      reasonCode: null,
      checkedAt,
      winningBallLetter: winningBall?.letter ?? null,
      winningBallNumber: winningBall?.number ?? null,
    });

    this.logger.log(
      `Winner window opened for session ${gameCartela.gameSessionId} until ${proposedWindowEndsAt.toISOString()} by cartela ${gameCartela.id}`,
    );

    await this.auditLogService.create(tx, {
      actorId: userId,
      action: 'player.bingo.winner_window.opened',
      entity: 'BingoClaim',
      entityId: claim.id,
      metadata: {
        sessionId: gameCartela.gameSessionId,
        gameCartelaId: gameCartela.id,
        gameRuleKey: ruleKey,
        matchedPattern,
        winnerWindowEndsAt: proposedWindowEndsAt.toISOString(),
        winningBall,
        claimAttemptId: attempt.claimAttemptId,
      },
    });

    const serializedClaim = serializePlayerBingoClaim(claim);
    const lastCalledNumber = this.lastCalledNumberFromClaim(claim);

    return {
      kind: 'auto_valid_open' as const,
      sessionId: gameCartela.gameSessionId,
      slotId: gameCartela.gameSession.gameSlot.id,
      gameStatus: GameStatus.WINNER_WINDOW,
      userId,
      gameCartelaId: gameCartela.id,
      cartelaNumber: gameCartela.cartela.number,
      claim: serializedClaim,
      winnerWindowEndsAt: proposedWindowEndsAt,
      completedPatterns,
      lastCalledNumber,
      sessionStatusBefore: GameStatus.PLAYING,
      cartelaStatusBefore: gameCartela.status,
      leanAutoCall: {
        autoCallEnabled: false,
        autoCallIntervalMs: gameCartela.gameSession.autoCallIntervalMs,
        nextAutoCallAt: null,
      },
      response: {
        claim: serializedClaim,
        progress,
        isWinner: true,
        gameStatus: GameStatus.WINNER_WINDOW,
        gameCartelaStatus: GameCartelaStatus.WINNER,
        winnerWindowEndsAt: proposedWindowEndsAt.toISOString(),
        reasonCode: null,
        completedPatterns,
        lastCalledNumber,
        nextAutoCallAt: null,
      },
    };
  }

  private async createAutoValidJoinWindowClaim(
    tx: Prisma.TransactionClient,
    gameCartela: ClaimCartelaRecord,
    userId: string,
    matchedPattern: string,
    completedPatterns: SerializedCompletedPattern[],
    winnerWindowClaimGraceMs: number,
    winningBall: WinningBallRecord | null,
    attempt: {
      existingClaimId: string;
      claimAttemptId: string;
      receivedAt: Date;
    },
  ) {
    const checkedAt = new Date();
    const winnerWindowEndsAt = gameCartela.gameSession.winnerWindowEndsAt;

    if (
      !winnerWindowEndsAt ||
      checkedAt.getTime() >
        winnerWindowEndsAt.getTime() + winnerWindowClaimGraceMs
    ) {
      throw new BadRequestException('Winner window has already closed');
    }

    const cartelaUpdateResult = await tx.gameCartela.updateMany({
      where: {
        id: gameCartela.id,
        status: GameCartelaStatus.REGISTERED,
        isWinner: false,
      },
      data: {
        status: GameCartelaStatus.WINNER,
        isWinner: true,
        blockedAt: null,
      },
    });

    if (cartelaUpdateResult.count !== 1) {
      throw new ConflictException('Cartela could not be marked as winner');
    }

    const claim = await this.completeCheckingClaim(tx, attempt, {
      status: BingoClaimStatus.VALID,
      checkedPattern: matchedPattern,
      reason: null,
      reasonCode: null,
      checkedAt,
      winningBallLetter: winningBall?.letter ?? null,
      winningBallNumber: winningBall?.number ?? null,
    });

    this.logger.log(
      `Cartela ${gameCartela.id} joined winner window for session ${gameCartela.gameSessionId}`,
    );

    await this.auditLogService.create(tx, {
      actorId: userId,
      action: 'player.bingo.winner_window.joined',
      entity: 'BingoClaim',
      entityId: claim.id,
      metadata: {
        sessionId: gameCartela.gameSessionId,
        gameCartelaId: gameCartela.id,
        matchedPattern,
        winningBall,
        claimAttemptId: attempt.claimAttemptId,
      },
    });

    const serializedClaim = serializePlayerBingoClaim(claim);
    const lastCalledNumber = this.lastCalledNumberFromClaim(claim);

    return {
      kind: 'auto_valid_join' as const,
      sessionId: gameCartela.gameSessionId,
      slotId: gameCartela.gameSession.gameSlot.id,
      gameStatus: GameStatus.WINNER_WINDOW,
      userId,
      gameCartelaId: gameCartela.id,
      cartelaNumber: gameCartela.cartela.number,
      claim: serializedClaim,
      winnerWindowEndsAt,
      completedPatterns,
      lastCalledNumber,
      sessionStatusBefore: GameStatus.WINNER_WINDOW,
      cartelaStatusBefore: gameCartela.status,
      leanAutoCall: {
        autoCallEnabled: false,
        autoCallIntervalMs: gameCartela.gameSession.autoCallIntervalMs,
        nextAutoCallAt: null,
      },
      response: {
        claim: serializedClaim,
        progress: 1,
        isWinner: true,
        gameStatus: GameStatus.WINNER_WINDOW,
        gameCartelaStatus: GameCartelaStatus.WINNER,
        winnerWindowEndsAt: winnerWindowEndsAt.toISOString(),
        reasonCode: null,
        completedPatterns,
        lastCalledNumber,
        nextAutoCallAt: null,
      },
    };
  }

  private lastCalledNumberFromClaim(
    claim: CreatedPlayerBingoClaimRecord,
  ): WinningBallRecord | null {
    if (claim.winningBallLetter == null || claim.winningBallNumber == null) {
      return null;
    }

    return {
      letter: claim.winningBallLetter,
      number: claim.winningBallNumber,
    };
  }

  private emitLeanAutoCallScheduleFromResult(result: ClaimSideEffectResult) {
    const lean = result.leanAutoCall;
    if (!lean) {
      return;
    }

    this.realtimeService.emitToGame(result.sessionId, 'game:operation_updated', {
      sessionId: result.sessionId,
      slotId: result.slotId,
      autoCallEnabled: lean.autoCallEnabled,
      autoCallIntervalMs: lean.autoCallIntervalMs,
      nextAutoCallAt: lean.nextAutoCallAt,
      updatedReason: 'auto_call_changed',
    });
  }

  /**
   * Claim-critical realtime only: uses in-memory txn result, no heavy reads.
   * Must complete before the HTTP response returns.
   */
  private emitClaimCriticalRealtime(result: ClaimSideEffectResult) {
    if (result.kind === 'manual_pending') {
      const claimedPayload = {
        sessionId: result.sessionId,
        userId: result.userId,
        gameCartelaId: result.gameCartelaId,
        cartelaNumber: result.cartelaNumber,
        claimId: result.claim.id,
        status: result.claim.status,
      };
      this.realtimeService.emitToGame(
        result.sessionId,
        'game:bingo_claimed',
        claimedPayload,
      );
      this.realtimeService.emitToAdmin('game:bingo_claimed', claimedPayload);
      this.realtimeService.emitToUser(
        result.userId,
        'game:bingo_claimed',
        claimedPayload,
      );
      this.emitLeanAutoCallScheduleFromResult(result);
      return;
    }

    if (result.kind === 'auto_invalid') {
      const invalidPayload = {
        sessionId: result.sessionId,
        userId: result.userId,
        gameCartelaId: result.gameCartelaId,
        cartelaNumber: result.cartelaNumber,
        claimId: result.claim.id,
        matchedPattern: result.claim.checkedPattern,
        reason: result.claim.reason,
        reasonCode: result.claim.reasonCode,
        progress: null,
        nextAutoCallAt: result.leanAutoCall?.nextAutoCallAt ?? null,
      };

      this.realtimeService.emitToGame(
        result.sessionId,
        'game:bingo_invalid',
        invalidPayload,
      );
      this.realtimeService.emitToAdmin('game:bingo_invalid', invalidPayload);
      this.realtimeService.emitToUser(
        result.userId,
        'game:bingo_invalid',
        invalidPayload,
      );
      this.emitLeanAutoCallScheduleFromResult(result);
      return;
    }

    if (result.kind === 'auto_failed') {
      const failedPayload = {
        sessionId: result.sessionId,
        userId: result.userId,
        gameCartelaId: result.gameCartelaId,
        cartelaNumber: result.cartelaNumber,
        claimAttemptId: result.claim.claimAttemptId,
        claimId: result.claim.id,
        retryAllowed: result.retryAllowed ?? true,
        nextAutoCallAt: result.leanAutoCall?.nextAutoCallAt ?? null,
        reasonCode: result.claim.failureCode,
      };
      this.realtimeService.emitToGame(
        result.sessionId,
        'game:bingo_claim_failed',
        failedPayload,
      );
      this.realtimeService.emitToAdmin('game:bingo_claim_failed', failedPayload);
      this.realtimeService.emitToUser(
        result.userId,
        'game:bingo_claim_failed',
        failedPayload,
      );
      this.emitLeanAutoCallScheduleFromResult(result);
      return;
    }

    const windowPayload = {
      sessionId: result.sessionId,
      userId: result.userId,
      gameCartelaId: result.gameCartelaId,
      cartelaNumber: result.cartelaNumber,
      claimId: result.claim.id,
      matchedPattern: result.claim.checkedPattern,
      winnerWindowEndsAt: result.winnerWindowEndsAt?.toISOString() ?? null,
      completedPatterns: result.completedPatterns ?? [],
      lastCalledNumber: result.lastCalledNumber ?? null,
    };

    if (result.kind === 'auto_valid_open') {
      this.realtimeService.emitToGame(
        result.sessionId,
        'game:winner_window_started',
        windowPayload,
      );
      this.realtimeService.emitToAdmin(
        'game:winner_window_started',
        windowPayload,
      );
      this.realtimeService.emitToUser(
        result.userId,
        'game:winner_window_started',
        windowPayload,
      );
      void this.notifyWinnerWindowPush(result.sessionId);
    } else if (result.kind === 'auto_valid_join') {
      this.realtimeService.emitToGame(
        result.sessionId,
        'game:winner_window_joined',
        windowPayload,
      );
      this.realtimeService.emitToAdmin(
        'game:winner_window_joined',
        windowPayload,
      );
      this.realtimeService.emitToUser(
        result.userId,
        'game:winner_window_joined',
        windowPayload,
      );
    }

    this.emitLeanAutoCallScheduleFromResult(result);
  }

  /**
   * Heavy structural reconciliation after HTTP returns. Failures are logged
   * and never affect the committed claim or HTTP status.
   */
  private async runDeferredClaimStructuralRefresh(
    result: ClaimSideEffectResult,
  ): Promise<void> {
    try {
      if (result.kind === 'auto_invalid') {
        const updatedSession = await this.prisma.gameSession.findUnique({
          where: { id: result.sessionId },
          select: gameSessionSelect,
        });

        if (updatedSession) {
          await this.emitSessionStatusChanged(updatedSession);
        }
        return;
      }

      await this.emitThinStructuralUpdate(result);
    } catch (error) {
      this.logger.warn(
        `[bingo_claim_structural_deferred_failed] sessionId=${result.sessionId} claimId=${result.claim.id} kind=${result.kind} error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private logBingoClaimPerf(fields: {
    sessionId: string;
    gameCartelaId: string;
    claimBranch: string;
    claimStatus: string;
    reasonCode: string | null;
    transactionMs: number;
    postCommitCriticalMs: number;
    totalHttpMs: number;
    sessionBefore: GameStatus | null;
    sessionAfter: GameStatus;
    cartelaAfter: string;
  }) {
    this.logger.log(
      `[bingo_claim_perf] requestId=${this.requestContext.getRequestIdForLog()} sessionId=${fields.sessionId} gameCartelaId=${fields.gameCartelaId} claimBranch=${fields.claimBranch} claimStatus=${fields.claimStatus} reasonCode=${fields.reasonCode ?? 'null'} transactionMs=${fields.transactionMs} postCommitCriticalMs=${fields.postCommitCriticalMs} totalHttpMs=${fields.totalHttpMs} sessionBefore=${fields.sessionBefore ?? 'null'} sessionAfter=${fields.sessionAfter} cartelaAfter=${fields.cartelaAfter}`,
    );
  }

  private async emitThinStructuralUpdate(result: {
    sessionId: string;
    slotId: string;
    gameStatus: GameStatus;
    winnerWindowEndsAt?: Date | null;
  }) {
    const updatedSession = await this.prisma.gameSession.findUnique({
      where: { id: result.sessionId },
      select: gameSessionSelect,
    });

    if (!updatedSession) {
      this.logger.warn(
        `[game_snapshot_null_blocked] sessionId=${result.sessionId} attemptedStatus=${result.gameStatus} emit=game:status_changed`,
      );
      return;
    }

    await this.emitSessionStatusChanged(updatedSession);
  }

  private async emitSessionStatusChanged(
    updatedSession: Prisma.GameSessionGetPayload<{
      select: typeof gameSessionSelect;
    }>,
  ) {
    this.operationsCacheService.invalidate();
    const sessionPayload = serializeGameSession(updatedSession);
    const playerPayload = toPlayerGameSession(sessionPayload);
    this.realtimeService.emitToGame(
      updatedSession.id,
      'game:status_changed',
      playerPayload,
    );
    this.realtimeService.emitToAdmin('game:status_changed', sessionPayload);
    this.realtimeService.emitToPublicGames(
      'game:status_changed',
      playerPayload,
    );
    await this.emitOperationUpdated(updatedSession.id);
    this.logger.log(
      `[game_transition_end] gameId=${updatedSession.id} previousStatus=${updatedSession.status} nextStatus=${updatedSession.status} committed=true emittedEvent=game:operation_updated`,
    );
  }

  private async emitOperationUpdated(sessionId: string) {
    const updatedSession = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: gameSessionSelect,
    });

    if (!updatedSession) {
      this.logger.warn(
        `[game_snapshot_null_blocked] sessionId=${sessionId} emit=game:operation_updated`,
      );
      return;
    }

    const updatedSlot = await this.prisma.gameSlot.findUnique({
      where: { id: updatedSession.gameSlotId },
      select: gameSlotSelect,
    });

    if (!updatedSlot) {
      this.logger.warn(
        `[game_snapshot_null_blocked] sessionId=${sessionId} slotMissing=true emit=game:operation_updated`,
      );
      return;
    }

    const sessionPayload = serializeGameSession(updatedSession);
    const adminSlotPayload = withTerminalSessionContextForAdminSlot(
      serializeGameSlot(updatedSlot),
      sessionPayload,
    );
    const publicSlotPayload = withTerminalSessionContextForPlayerSlot(
      toPlayerGameSlot(adminSlotPayload),
      toPlayerGameSession(sessionPayload),
    );

    this.realtimeService.emitGameOperationUpdate({
      slotId: updatedSession.gameSlotId,
      sessionId,
      adminPayload: adminSlotPayload,
      publicPayload: publicSlotPayload,
    });
  }

  /**
   * Push the refreshed session to clients after a chain round boundary. The
   * session is still PLAYING, so this must NOT go through emitSessionFinished.
   */
  private async emitChainSessionUpdated(sessionId: string): Promise<void> {
    this.operationsCacheService.invalidate();

    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: gameSessionSelect,
    });

    if (!session) {
      return;
    }

    const adminPayload = serializeGameSession(session);
    const publicPayload = toPlayerGameSession(adminPayload);

    this.realtimeService.emitToSession(
      sessionId,
      'game:status_changed',
      publicPayload,
    );
    this.realtimeService.emitToAdmin('game:status_changed', adminPayload);
    this.realtimeService.emitToPublicGames(
      'game:status_changed',
      publicPayload,
    );
    this.realtimeService.emitGameOperationUpdate({
      slotId: session.gameSlotId,
      sessionId,
      adminPayload,
      publicPayload,
    });
  }

  private async emitWalletUpdated(userId: string): Promise<void> {
    const wallet = await this.walletService.getSerializedWallet(userId);
    this.realtimeService.emitToUser(userId, 'wallet:updated', wallet);
    this.realtimeService.emitToAdmin('wallet:updated', wallet);
  }

  private async notifyWinnerWindowPush(sessionId: string) {
    try {
      const cartelas = await this.prisma.gameCartela.findMany({
        where: { gameSessionId: sessionId },
        select: { userId: true },
      });
      const participantUserIds = [
        ...new Set(cartelas.map((cartela) => cartela.userId)),
      ];
      await this.gamePushNotificationsService.notifyWinnerWindowStarted(
        sessionId,
        participantUserIds,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to send winner-window push for session ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
