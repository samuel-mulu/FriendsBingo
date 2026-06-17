import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BingoClaimStatus,
  GameCartelaStatus,
  GameStatus,
  Prisma,
  UserRole,
  WalletTransactionType,
} from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
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
import { gameSessionSelect, gameSlotSelect } from '../games/games.select';
import { OperationsCacheService } from '../games/operations-cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WalletService } from '../wallet/wallet.service';
import { GameTimingConfigService } from '../game-timing-config/game-timing-config.service';
import { RejectBingoClaimDto } from './dto/reject-bingo-claim.dto';
import {
  BingoClaimReasonCode,
  serializeBingoClaim,
  serializePlayerBingoClaim,
} from './bingo-claims.mapper';
import {
  bingoClaimSelect,
  createdPlayerBingoClaimSelect,
  finalClaimStatuses,
} from './bingo-claims.select';
import { splitPrizeAmount } from './prize-split.util';

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
  ) {}

  async claimBingo(sessionId: string, userId: string, gameCartelaId: string) {
    const checkingPreview = await this.prisma.gameCartela.findFirst({
      where: {
        id: gameCartelaId,
        gameSessionId: sessionId,
        userId,
      },
      select: {
        id: true,
        status: true,
        isWinner: true,
        cartela: {
          select: { number: true },
        },
      },
    });

    if (
      checkingPreview &&
      checkingPreview.status === GameCartelaStatus.REGISTERED &&
      !checkingPreview.isWinner
    ) {
      this.realtimeService.emitToGame(sessionId, 'game:bingo_checking', {
        sessionId,
        userId,
        gameCartelaId: checkingPreview.id,
        cartelaNumber: checkingPreview.cartela.number,
      });
    }

    return this.requestPerformance.run(
      {
        operation: 'claimBingo',
        userRole: UserRole.PLAYER,
      },
      async () => {
        const result = await this.prisma.$transaction(async (tx) => {
          const gameCartela = await this.loadClaimCartela(
            tx,
            sessionId,
            userId,
            gameCartelaId,
          );
          const terminalReasonCode =
            this.getTerminalClaimReasonCode(gameCartela);

          if (terminalReasonCode) {
            return this.createAlreadyResolvedClaimResponse(
              tx,
              gameCartela,
              userId,
              terminalReasonCode,
            );
          }

          const ruleKey = this.resolveRuleKey(gameCartela);

          if (this.gameRuleEvaluationService.isManualRule(ruleKey)) {
            return this.createManualPendingClaim(
              tx,
              gameCartela,
              userId,
              ruleKey,
            );
          }

          return this.createAutoValidatedClaim(
            tx,
            gameCartela,
            userId,
            ruleKey,
          );
        });

        if (result.kind !== 'already_resolved') {
          await this.emitClaimSideEffects(result);
        }
        return result.response;
      },
    );
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
          gameCartelas: {
            where: {
              isWinner: true,
              status: GameCartelaStatus.WINNER,
            },
            select: {
              id: true,
              userId: true,
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

      const prizeShares = splitPrizeAmount(
        session.prizeAmount,
        session.gameCartelas.length,
      );

      for (const [index, winner] of session.gameCartelas.entries()) {
        await this.walletService.creditWallet(
          tx,
          winner.userId,
          prizeShares[index],
          {
            type: WalletTransactionType.PRIZE_WIN,
            referenceType: 'GAME_CARTELA',
            referenceId: winner.id,
            description: `Prize win for session ${session.playCode}`,
          },
        );
      }

      const finishedAt = new Date();
      const primaryWinnerId = session.gameCartelas[0]?.id ?? null;
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
        },
      });

      if (finishResult.count !== 1) {
        throw new ConflictException('Winner window already finalized');
      }

      await this.gameQueueService.moveSlotToBack(tx, session.gameSlotId);
      await tx.gameSlot.update({
        where: { id: session.gameSlotId },
        data: { status: GameStatus.NEXT },
      });

      await this.auditLogService.create(tx, {
        actorId: null,
        action: 'system.winner_window.finalize',
        entity: 'GameSession',
        entityId: session.id,
        metadata: {
          winnerCount: session.gameCartelas.length,
          prizeAmount: session.prizeAmount.toString(),
        },
      });

      return {
        sessionId: session.id,
        winnerUserIds: session.gameCartelas.map((winner) => winner.userId),
      };
    });

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

    await this.gameEngineService.emitSessionFinished(finalized.sessionId);

    return finalized;
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

      if (claim.gameSession.status === GameStatus.FINISHED) {
        throw new BadRequestException('Game already finished');
      }

      const ruleKey =
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

      const sessionFinished = await this.gameEngineService.finishGameWithWinner(
        tx,
        claim.gameSession.id,
        claim.gameCartela.id,
        checkedAt,
      );

      if (!sessionFinished) {
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

    await this.gameEngineService.emitSessionFinished(result.sessionId);

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

      const updatedClaim = await tx.bingoClaim.update({
        where: { id: claim.id },
        data: {
          status: BingoClaimStatus.INVALID,
          reason:
            rejectBingoClaimDto.reason?.trim() ||
            'Rejected after manual admin review',
          reasonCode: null,
          checkedAt,
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

    if (gameCartela.gameSession.status === GameStatus.FINISHED) {
      throw new BadRequestException('Game already finished');
    }
  }

  private resolveRuleKey(gameCartela: ClaimCartelaRecord): string {
    return (
      gameCartela.gameSession.gameSlot.gameRule?.key ??
      gameCartela.gameSession.gameSlot.gameType
    );
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

    const claim =
      existingClaim ??
      (await tx.bingoClaim.create({
        data: {
          gameSessionId: gameCartela.gameSessionId,
          userId,
          gameCartelaId: gameCartela.id,
          status: BingoClaimStatus.INVALID,
          checkedPattern: this.resolveRuleKey(gameCartela),
          reason: TERMINAL_CLAIM_REASONS[reasonCode],
          reasonCode,
          checkedAt: new Date(),
        },
        select: createdPlayerBingoClaimSelect,
      }));

    const serializedClaim = serializePlayerBingoClaim(claim, { reasonCode });

    return {
      kind: 'already_resolved' as const,
      response: {
        claim: serializedClaim,
        progress: null,
        isWinner: reasonCode === 'ALREADY_WINNER',
        gameStatus: gameCartela.gameSession.status,
        gameCartelaStatus: gameCartela.status,
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
  ) {
    this.assertClaimableCartela(gameCartela);

    if (gameCartela.gameSession.status !== GameStatus.PLAYING) {
      throw new BadRequestException('Game must be PLAYING to claim bingo');
    }

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

    const claim = await tx.bingoClaim.create({
      data: {
        gameSessionId: gameCartela.gameSessionId,
        userId,
        gameCartelaId: gameCartela.id,
        status: BingoClaimStatus.PENDING,
        checkedPattern: ruleKey,
        reason: 'Waiting for admin confirmation',
        reasonCode: null,
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
      response: {
        claim: serializedClaim,
        progress: null,
        isWinner: false,
        gameStatus: GameStatus.CHECKING,
        gameCartelaStatus: GameCartelaStatus.REGISTERED,
        reasonCode: null,
      },
    };
  }

  private async createAutoValidatedClaim(
    tx: Prisma.TransactionClient,
    gameCartela: ClaimCartelaRecord,
    userId: string,
    ruleKey: string,
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

    // Pause auto-call immediately while the claim is evaluated so no ball is
    // drawn mid-check. Invalid claims restore the paused countdown; valid
    // claims open or join the winner window with auto-call disabled.
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
    }

    const [defaultAutoCallIntervalMs, winnerWindowDurationMs, winnerWindowClaimGraceMs] =
      await Promise.all([
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
      gameCartela.gameSession.gameSlot.gameRule?.patterns,
    );

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
      );
    }

    const completedPatterns = this.serializeCartelaCompletedPatterns(
      gameCartela,
      evaluation.completedPatterns,
    );

    if (sessionStatus === GameStatus.WINNER_WINDOW) {
      return this.createAutoValidJoinWindowClaim(
        tx,
        gameCartela,
        userId,
        evaluation.matchedPattern,
        completedPatterns,
        winnerWindowClaimGraceMs,
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
      Date.now() +
        (autoCallIntervalMs ?? defaultAutoCallIntervalMs),
    );
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

    const claim = await tx.bingoClaim.create({
      data: {
        gameSessionId: gameCartela.gameSessionId,
        userId,
        gameCartelaId: gameCartela.id,
        status: BingoClaimStatus.INVALID,
        checkedPattern: matchedPattern || ruleKey,
        reason,
        reasonCode,
        checkedAt,
      },
      select: createdPlayerBingoClaimSelect,
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
      },
    });

    // Restore the paused auto-call countdown so the next ball waits the
    // same remaining time (or draws immediately when already due).
    if (gameCartela.gameSession.autoCallEnabled) {
      await tx.gameSession.updateMany({
        where: {
          id: gameCartela.gameSessionId,
          status: GameStatus.PLAYING,
          autoCallEnabled: true,
        },
        data: {
          nextAutoCallAt: this.computeInvalidClaimResumeAt(
            pausedRemainingMs,
            hadScheduledAutoCall,
            defaultAutoCallIntervalMs,
            gameCartela.gameSession.autoCallIntervalMs,
          ),
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
      response: {
        claim: serializedClaim,
        progress: null,
        isWinner: false,
        gameStatus: gameCartela.gameSession.status,
        gameCartelaStatus: GameCartelaStatus.BLOCKED,
        reasonCode,
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

    const claim = await tx.bingoClaim.create({
      data: {
        gameSessionId: gameCartela.gameSessionId,
        userId,
        gameCartelaId: gameCartela.id,
        status: BingoClaimStatus.VALID,
        checkedPattern: matchedPattern,
        reason: null,
        reasonCode: null,
        checkedAt,
      },
      select: createdPlayerBingoClaimSelect,
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
      },
    });

    const serializedClaim = serializePlayerBingoClaim(claim);

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
      response: {
        claim: serializedClaim,
        progress,
        isWinner: true,
        gameStatus: GameStatus.WINNER_WINDOW,
        gameCartelaStatus: GameCartelaStatus.WINNER,
        winnerWindowEndsAt: proposedWindowEndsAt.toISOString(),
        reasonCode: null,
        completedPatterns,
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

    const claim = await tx.bingoClaim.create({
      data: {
        gameSessionId: gameCartela.gameSessionId,
        userId,
        gameCartelaId: gameCartela.id,
        status: BingoClaimStatus.VALID,
        checkedPattern: matchedPattern,
        reason: null,
        reasonCode: null,
        checkedAt,
      },
      select: createdPlayerBingoClaimSelect,
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
      },
    });

    const serializedClaim = serializePlayerBingoClaim(claim);

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
      response: {
        claim: serializedClaim,
        progress: 1,
        isWinner: true,
        gameStatus: GameStatus.WINNER_WINDOW,
        gameCartelaStatus: GameCartelaStatus.WINNER,
        winnerWindowEndsAt: winnerWindowEndsAt.toISOString(),
        reasonCode: null,
        completedPatterns,
      },
    };
  }

  private async emitClaimSideEffects(result: {
    kind:
      | 'already_resolved'
      | 'manual_pending'
      | 'auto_invalid'
      | 'auto_valid_open'
      | 'auto_valid_join';
    sessionId: string;
    slotId: string;
    gameStatus: GameStatus;
    userId: string;
    gameCartelaId: string;
    cartelaNumber?: number;
    claim: PlayerClaimPayload;
    winnerWindowEndsAt?: Date;
    completedPatterns?: SerializedCompletedPattern[];
  }) {
    if (result.kind === 'manual_pending') {
      this.realtimeService.emitToGame(result.sessionId, 'game:bingo_claimed', {
        sessionId: result.sessionId,
        userId: result.userId,
        gameCartelaId: result.gameCartelaId,
        cartelaNumber: result.cartelaNumber,
        claimId: result.claim.id,
        status: result.claim.status,
      });
      this.realtimeService.emitToAdmin('game:bingo_claimed', {
        sessionId: result.sessionId,
        userId: result.userId,
        gameCartelaId: result.gameCartelaId,
        cartelaNumber: result.cartelaNumber,
        claimId: result.claim.id,
        status: result.claim.status,
      });
      this.realtimeService.emitToUser(result.userId, 'game:bingo_claimed', {
        sessionId: result.sessionId,
        userId: result.userId,
        gameCartelaId: result.gameCartelaId,
        cartelaNumber: result.cartelaNumber,
        claimId: result.claim.id,
        status: result.claim.status,
      });

      this.emitThinStructuralUpdate(result);
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
    } else {
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

    this.emitThinStructuralUpdate(result);
  }

  private emitThinStructuralUpdate(result: {
    sessionId: string;
    slotId: string;
    gameStatus: GameStatus;
    winnerWindowEndsAt?: Date | null;
  }) {
    this.operationsCacheService.invalidate();
    const payload = {
      sessionId: result.sessionId,
      status: result.gameStatus,
      ...(result.winnerWindowEndsAt
        ? {
            winnerWindowEndsAt: result.winnerWindowEndsAt.toISOString(),
          }
        : {}),
    };

    this.realtimeService.emitToGame(
      result.sessionId,
      'game:status_changed',
      payload,
    );
    this.realtimeService.emitToAdmin('game:status_changed', payload);
    this.realtimeService.emitToPublicGames('game:status_changed', payload);
    this.realtimeService.emitGameOperationUpdate({
      slotId: result.slotId,
      sessionId: result.sessionId,
      adminPayload: payload,
      publicPayload: payload,
    });
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
  }

  private async emitOperationUpdated(sessionId: string) {
    const updatedSession = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: gameSessionSelect,
    });

    if (!updatedSession) {
      return;
    }

    const updatedSlot = await this.prisma.gameSlot.findUnique({
      where: { id: updatedSession.gameSlotId },
      select: gameSlotSelect,
    });

    if (!updatedSlot) {
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

  private async emitWalletUpdated(userId: string): Promise<void> {
    const wallet = await this.walletService.getSerializedWallet(userId);
    this.realtimeService.emitToUser(userId, 'wallet:updated', wallet);
    this.realtimeService.emitToAdmin('wallet:updated', wallet);
  }
}
