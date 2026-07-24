import { Injectable, Logger } from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GameLifecycleDebugLogger } from './game-lifecycle-debug-logger.service';
import { GameLifecycleService } from './game-lifecycle.service';

/**
 * Service for repairing invalid game operation states.
 *
 * Phase 1: Repairs orphan/invalid READY sessions that have:
 * - Missing slot
 * - Cancelled slot
 * - Invalid slot state
 *
 * This service is safe to run in production and is idempotent.
 */
@Injectable()
export class GameOperationRepairService {
  private readonly logger = new Logger(GameOperationRepairService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleLogger: GameLifecycleDebugLogger,
    private readonly gameLifecycleService: GameLifecycleService,
  ) {}

  /**
   * Find all READY sessions with invalid/missing slots.
   *
   * A READY session is invalid if:
   * - Slot is missing (deleted)
   * - Slot is CANCELLED
   * - Slot is in an invalid state for registration
   */
  async findInvalidReadySessions() {
    const readySessions = await this.prisma.gameSession.findMany({
      where: {
        status: GameStatus.READY,
      },
      select: {
        id: true,
        gameSlotId: true,
        playCode: true,
        createdAt: true,
        _count: {
          select: {
            gameCartelas: true,
          },
        },
        gameSlot: {
          select: {
            id: true,
            status: true,
            category: true,
            operationMode: true,
          },
        },
      },
    });

    const invalidSessions = readySessions.filter((session) => {
      // Missing slot
      if (!session.gameSlot) {
        this.lifecycleLogger.invalidReadySessionDetected({
          sessionId: session.id,
          slotId: session.gameSlotId,
          reason: 'missing_slot',
          hasRegistrations: session._count.gameCartelas > 0,
        });
        return true;
      }

      // Cancelled slot
      if (session.gameSlot.status === GameStatus.CANCELLED) {
        this.lifecycleLogger.invalidReadySessionDetected({
          sessionId: session.id,
          slotId: session.gameSlotId,
          reason: 'cancelled_slot',
          slotStatus: session.gameSlot.status,
          hasRegistrations: session._count.gameCartelas > 0,
        });
        return true;
      }

      // Slot in invalid state (PLAYING, CHECKING, WINNER_WINDOW, FINISHED)
      // These states mean the slot is already in use by another session
      if (
        session.gameSlot.status === GameStatus.PLAYING ||
        session.gameSlot.status === GameStatus.CHECKING ||
        session.gameSlot.status === GameStatus.WINNER_WINDOW ||
        session.gameSlot.status === GameStatus.FINISHED ||
        session.gameSlot.status === GameStatus.NO_WINNER
      ) {
        this.lifecycleLogger.invalidReadySessionDetected({
          sessionId: session.id,
          slotId: session.gameSlotId,
          reason: 'slot_in_active_state',
          slotStatus: session.gameSlot.status,
          hasRegistrations: session._count.gameCartelas > 0,
        });
        return true;
      }

      return false;
    });

    return invalidSessions;
  }

  /**
   * Repair a single invalid READY session by cancelling it.
   *
   * If the session has registered cartelas, uses the existing
   * cancel/refund lifecycle path via GameLifecycleService.
   *
   * If no registrations, directly marks as CANCELLED.
   */
  async repairInvalidReadySession(
    sessionId: string,
    reason: string,
    dryRun = false,
  ): Promise<{ repaired: boolean; hadRegistrations: boolean }> {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        gameSlotId: true,
        _count: {
          select: {
            gameCartelas: true,
          },
        },
      },
    });

    if (!session) {
      this.logger.warn(`Session ${sessionId} not found, skipping repair`);
      return { repaired: false, hadRegistrations: false };
    }

    if (session.status !== GameStatus.READY) {
      this.logger.warn(
        `Session ${sessionId} is ${session.status}, not READY, skipping repair`,
      );
      return { repaired: false, hadRegistrations: false };
    }

    const hasRegistrations = session._count.gameCartelas > 0;

    if (dryRun) {
      this.logger.log(
        `[DRY RUN] Would repair session ${sessionId} (${hasRegistrations ? 'with' : 'without'} registrations)`,
      );
      return { repaired: false, hadRegistrations: hasRegistrations };
    }

    if (hasRegistrations) {
      // Use existing cancel/refund lifecycle
      this.logger.log(
        `Repairing session ${sessionId} with registrations via GameLifecycleService`,
      );
      await this.gameLifecycleService.cancelSession(
        sessionId,
        'admin_cancelled', // Use admin_cancelled as closest match
        { actorId: undefined }, // No actor for automated repair
      );
    } else {
      // No registrations, safe to directly mark as CANCELLED
      this.logger.log(
        `Repairing session ${sessionId} without registrations (direct cancel)`,
      );
      await this.prisma.gameSession.update({
        where: { id: sessionId },
        data: {
          status: GameStatus.CANCELLED,
          cancelledReason: reason,
        },
      });
    }

    this.lifecycleLogger.invalidReadySessionRepaired({
      sessionId,
      slotId: session.gameSlotId,
      reason,
      hadRegistrations: hasRegistrations,
    });

    return { repaired: true, hadRegistrations: hasRegistrations };
  }

  /**
   * Repair all invalid READY sessions.
   *
   * Safe to run in production. Idempotent.
   *
   * @param dryRun If true, only logs what would be repaired without making changes
   * @returns Summary of repair operation
   */
  async repairAllInvalidReadySessions(dryRun = false): Promise<{
    found: number;
    repaired: number;
    withRegistrations: number;
    withoutRegistrations: number;
  }> {
    this.logger.log(
      `Starting invalid READY session repair${dryRun ? ' (DRY RUN)' : ''}...`,
    );

    const invalidSessions = await this.findInvalidReadySessions();

    this.logger.log(`Found ${invalidSessions.length} invalid READY sessions`);

    let repaired = 0;
    let withRegistrations = 0;
    let withoutRegistrations = 0;

    for (const session of invalidSessions) {
      try {
        const result = await this.repairInvalidReadySession(
          session.id,
          'invalid_ready_session_repair',
          dryRun,
        );

        if (result.repaired) {
          repaired++;
          if (result.hadRegistrations) {
            withRegistrations++;
          } else {
            withoutRegistrations++;
          }
        }
      } catch (error) {
        this.logger.error(
          `Failed to repair session ${session.id}: ${error.message}`,
          error.stack,
        );
      }
    }

    const summary = {
      found: invalidSessions.length,
      repaired,
      withRegistrations,
      withoutRegistrations,
    };

    this.logger.log(
      `Repair complete${dryRun ? ' (DRY RUN)' : ''}: ${JSON.stringify(summary)}`,
    );

    return summary;
  }

  /**
   * Check if a slot is valid for creating a READY session.
   *
   * Used to prevent creating orphan READY sessions.
   */
  async isSlotValidForReadySession(slotId: string): Promise<{
    valid: boolean;
    reason?: string;
  }> {
    const slot = await this.prisma.gameSlot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        status: true,
        category: true,
        operationMode: true,
      },
    });

    if (!slot) {
      return { valid: false, reason: 'slot_not_found' };
    }

    if (slot.status === GameStatus.CANCELLED) {
      return { valid: false, reason: 'slot_cancelled' };
    }

    // Only NEXT and READY slots can have new READY sessions created
    if (slot.status !== GameStatus.NEXT && slot.status !== GameStatus.READY) {
      return {
        valid: false,
        reason: `slot_in_invalid_state_${slot.status}`,
      };
    }

    return { valid: true };
  }
}
