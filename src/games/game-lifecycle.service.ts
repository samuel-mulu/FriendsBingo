import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  GameCartelaStatus,
  GameStatus,
  Prisma,
  WalletTransactionType,
} from '@prisma/client';
import { AuditLogService } from '../common/services/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WalletService } from '../wallet/wallet.service';
import { GameQueueService } from './game-queue.service';
import {
  serializeGameSession,
  serializeGameSlot,
  toPlayerGameSession,
  toPlayerGameSlot,
  withTerminalSessionContextForAdminSlot,
  withTerminalSessionContextForPlayerSlot,
} from './games.mapper';
import { gameSessionSelect, gameSlotSelect } from './games.select';
import { OperationsCacheService } from './operations-cache.service';

export type GameCancelReason = 'no_players' | 'admin_cancelled';

export interface CancelSessionOptions {
  actorId?: string;
  /**
   * Move the slot to the back of the queue (default). Set to false when the
   * slot itself is being cancelled/removed by the caller.
   */
  requeueSlot?: boolean;
  /**
   * Abort (rollback) instead of cancelling when paid cartelas exist.
   * Used by the AUTO scheduler so a registration that races the empty-session
   * cancel results in the game starting instead of stranding paid cartelas.
   */
  abortIfPlayersRegistered?: boolean;
}

export type CancelSessionResult =
  | { aborted: true }
  | {
      aborted: false;
      sessionId: string;
      slotId: string;
      reason: GameCancelReason;
      refundedCount: number;
      alreadyCancelled?: boolean;
    };

/** Internal control-flow signal: rolls back the cancel transaction. */
class CancelAbortedError extends Error {
  constructor() {
    super('Cancel aborted: players registered during cancellation');
  }
}

class CancelAlreadyCompletedError extends Error {
  constructor(
    readonly sessionId: string,
    readonly slotId: string,
    readonly storedReason: string | null,
  ) {
    super('Cancel skipped: session already cancelled');
  }
}

const CANCELLABLE_SESSION_STATUSES: GameStatus[] = [
  GameStatus.READY,
  GameStatus.PLAYING,
  GameStatus.CHECKING,
];

/**
 * Single owner of the session-cancel transition.
 *
 * All cancel paths (admin force-cancel, admin slot cancel, AUTO empty-session
 * skip) MUST go through cancelSession so that:
 * - status transitions are guarded with an optimistic updateMany claim
 * - every paid (non-cancelled) cartela is refunded inside the same transaction
 * - cartelas are marked CANCELLED so they never count for a future round
 * - the slot is rotated back to the queue exactly once
 * - one consistent set of socket events (game:cancelled + game:status_changed
 *   + game:operation_updated) is emitted and the operations cache is invalidated
 */
@Injectable()
export class GameLifecycleService {
  private readonly logger = new Logger(GameLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly gameQueueService: GameQueueService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
    private readonly operationsCacheService: OperationsCacheService,
  ) {}

  async cancelSession(
    sessionId: string,
    reason: GameCancelReason,
    options: CancelSessionOptions = {},
  ): Promise<CancelSessionResult> {
    const requeueSlot = options.requeueSlot ?? true;

    const existing = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        gameSlotId: true,
        cancelledReason: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Session not found');
    }

    if (existing.status === GameStatus.WINNER_WINDOW) {
      throw new BadRequestException(
        'Winner window sessions cannot be cancelled. Finalize the winner window early to pay winners and finish the game.',
      );
    }

    if (existing.status === GameStatus.CANCELLED) {
      return this.buildAlreadyCancelledResult(existing, reason);
    }

    if (!CANCELLABLE_SESSION_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        `Session is already ${existing.status} and cannot be cancelled`,
      );
    }

    let txResult: {
      cancelledSession: Prisma.GameSessionGetPayload<{
        select: typeof gameSessionSelect;
      }>;
      updatedSlot: Prisma.GameSlotGetPayload<{
        select: typeof gameSlotSelect;
      }> | null;
      refundedUserIds: string[];
      refundedCount: number;
    };

    try {
      txResult = await this.prisma.$transaction(async (tx) => {
        const session = await tx.gameSession.findUnique({
          where: { id: sessionId },
          select: {
            id: true,
            status: true,
            gameSlotId: true,
            playCode: true,
            entryFee: true,
          },
        });

        if (!session) {
          throw new NotFoundException('Session not found');
        }

        if (session.status === GameStatus.WINNER_WINDOW) {
          throw new BadRequestException(
            'Winner window sessions cannot be cancelled. Finalize the winner window early to pay winners and finish the game.',
          );
        }

        if (session.status === GameStatus.CANCELLED) {
          throw new CancelAlreadyCompletedError(
            sessionId,
            session.gameSlotId,
            null,
          );
        }

        if (!CANCELLABLE_SESSION_STATUSES.includes(session.status)) {
          throw new BadRequestException(
            `Session is already ${session.status} and cannot be cancelled`,
          );
        }

        // Optimistic claim: only one caller wins the transition.
        const claim = await tx.gameSession.updateMany({
          where: {
            id: sessionId,
            status: { in: CANCELLABLE_SESSION_STATUSES },
          },
          data: {
            status: GameStatus.CANCELLED,
            cancelledReason: reason,
            autoCallEnabled: false,
            nextAutoCallAt: null,
            scheduledStartAt: null,
          },
        });

        if (claim.count !== 1) {
          const current = await tx.gameSession.findUnique({
            where: { id: sessionId },
            select: {
              status: true,
              gameSlotId: true,
              cancelledReason: true,
            },
          });

          if (current?.status === GameStatus.CANCELLED) {
            throw new CancelAlreadyCompletedError(
              sessionId,
              current.gameSlotId,
              current.cancelledReason,
            );
          }

          throw new ConflictException(
            'Session was already finished or cancelled',
          );
        }

        // Read cartelas AFTER claiming the status so a registration that
        // committed just before this transaction is still visible here.
        const paidCartelas = await tx.gameCartela.findMany({
          where: {
            gameSessionId: sessionId,
            status: { not: GameCartelaStatus.CANCELLED },
          },
          select: { id: true, userId: true },
        });

        if (options.abortIfPlayersRegistered && paidCartelas.length > 0) {
          // Rolls back the status claim; the caller should start the game.
          throw new CancelAbortedError();
        }

        for (const cartela of paidCartelas) {
          await this.walletService.creditWallet(
            tx,
            cartela.userId,
            session.entryFee,
            {
              type: WalletTransactionType.REFUND,
              referenceType: 'GAME_CARTELA',
              referenceId: cartela.id,
              description: `Entry fee refund for cancelled game ${session.playCode}`,
            },
          );
        }

        if (paidCartelas.length > 0) {
          await tx.gameCartela.updateMany({
            where: {
              gameSessionId: sessionId,
              status: { not: GameCartelaStatus.CANCELLED },
            },
            data: { status: GameCartelaStatus.CANCELLED },
          });
        }

        if (requeueSlot) {
          await this.gameQueueService.moveSlotToBack(tx, session.gameSlotId);
        }

        await this.auditLogService.create(tx, {
          actorId: options.actorId ?? null,
          action: options.actorId
            ? 'admin.session.force_cancel'
            : 'system.session.cancel',
          entity: 'GameSession',
          entityId: sessionId,
          metadata: {
            previousStatus: session.status,
            reason,
            refundedCount: paidCartelas.length,
          },
        });

        const cancelledSession = await tx.gameSession.findUnique({
          where: { id: sessionId },
          select: gameSessionSelect,
        });

        const updatedSlot = await tx.gameSlot.findUnique({
          where: { id: session.gameSlotId },
          select: gameSlotSelect,
        });

        return {
          cancelledSession: cancelledSession!,
          updatedSlot,
          refundedUserIds: [
            ...new Set(paidCartelas.map((cartela) => cartela.userId)),
          ],
          refundedCount: paidCartelas.length,
        };
      });
    } catch (error) {
      if (error instanceof CancelAbortedError) {
        return { aborted: true };
      }

      if (error instanceof CancelAlreadyCompletedError) {
        return this.buildAlreadyCancelledResult(
          {
            id: error.sessionId,
            gameSlotId: error.slotId,
            cancelledReason: error.storedReason,
          },
          reason,
        );
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || error.code === 'P2028')
      ) {
        const raced = await this.prisma.gameSession.findUnique({
          where: { id: sessionId },
          select: {
            id: true,
            status: true,
            gameSlotId: true,
            cancelledReason: true,
          },
        });

        if (raced?.status === GameStatus.CANCELLED) {
          return this.buildAlreadyCancelledResult(raced, reason);
        }
      }

      throw error;
    }

    this.operationsCacheService.invalidate();
    this.emitSessionCancelled(txResult, reason);

    for (const userId of txResult.refundedUserIds) {
      void this.emitWalletUpdated(userId);
    }

    this.logger.log(
      `Cancelled session ${sessionId} (reason=${reason}, refunded=${txResult.refundedCount})`,
    );

    return {
      aborted: false,
      sessionId,
      slotId: txResult.cancelledSession.gameSlotId,
      reason,
      refundedCount: txResult.refundedCount,
    };
  }

  private buildAlreadyCancelledResult(
    session: {
      id: string;
      gameSlotId: string;
      cancelledReason: string | null;
    },
    fallbackReason: GameCancelReason,
  ): CancelSessionResult {
    const storedReason = session.cancelledReason;
    const resolvedReason: GameCancelReason =
      storedReason === 'no_players' || storedReason === 'admin_cancelled'
        ? storedReason
        : fallbackReason;

    return {
      aborted: false,
      sessionId: session.id,
      slotId: session.gameSlotId,
      reason: resolvedReason,
      refundedCount: 0,
      alreadyCancelled: true,
    };
  }

  private emitSessionCancelled(
    result: {
      cancelledSession: Prisma.GameSessionGetPayload<{
        select: typeof gameSessionSelect;
      }>;
      updatedSlot: Prisma.GameSlotGetPayload<{
        select: typeof gameSlotSelect;
      }> | null;
      refundedCount: number;
    },
    reason: GameCancelReason,
  ): void {
    const session = result.cancelledSession;
    const sessionPayload = serializeGameSession(session);
    const playerSessionPayload = toPlayerGameSession(sessionPayload);

    const cancelledPayload = {
      sessionId: session.id,
      slotId: session.gameSlotId,
      status: GameStatus.CANCELLED,
      reason,
      refundedCount: result.refundedCount,
    };

    this.realtimeService.emitGameCancelled({
      sessionId: session.id,
      payload: cancelledPayload,
    });

    this.realtimeService.emitToSession(
      session.id,
      'game:status_changed',
      playerSessionPayload,
    );
    this.realtimeService.emitToAdmin('game:status_changed', sessionPayload);
    this.realtimeService.emitToPublicGames(
      'game:status_changed',
      playerSessionPayload,
    );

    if (result.updatedSlot) {
      const adminSlotPayload = withTerminalSessionContextForAdminSlot(
        serializeGameSlot(result.updatedSlot),
        sessionPayload,
      );
      const publicSlotPayload = withTerminalSessionContextForPlayerSlot(
        toPlayerGameSlot(adminSlotPayload),
        playerSessionPayload,
      );

      this.realtimeService.emitGameOperationUpdate({
        slotId: session.gameSlotId,
        sessionId: session.id,
        adminPayload: adminSlotPayload,
        publicPayload: publicSlotPayload,
      });
    }
  }

  private async emitWalletUpdated(userId: string): Promise<void> {
    try {
      const wallet = await this.walletService.getSerializedWallet(userId);
      this.realtimeService.emitToUser(userId, 'wallet:updated', wallet);
      this.realtimeService.emitToAdmin('wallet:updated', wallet);
    } catch (error) {
      this.logger.warn(
        `Failed to emit wallet update for user ${userId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }
}
