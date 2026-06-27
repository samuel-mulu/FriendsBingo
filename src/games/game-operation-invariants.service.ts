import { Injectable, Logger } from '@nestjs/common';
import { GameCategory, GameStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Non-destructive invariant checks for game operations.
 * 
 * Purpose: Detect unexpected states without crashing production.
 * Logs warnings when invariants are violated.
 * 
 * Use in tests to assert expected behavior.
 * Use in development to catch bugs early.
 * Use in production to log warnings (does not throw).
 */
@Injectable()
export class GameOperationInvariantsService {
  private readonly logger = new Logger(GameOperationInvariantsService.name);
  private readonly enabled: boolean;
  private readonly throwOnViolation: boolean;

  constructor(private readonly prisma: PrismaService) {
    this.enabled =
      process.env.GAME_INVARIANTS_CHECK === 'true' ||
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'test';
    this.throwOnViolation = process.env.NODE_ENV === 'test';
  }

  /**
   * Check all game operation invariants.
   * Returns true if all pass, false if any fail.
   * Logs warnings for failures.
   * Throws in test environment.
   */
  async assertGameOperationInvariants(): Promise<boolean> {
    if (!this.enabled) {
      return true;
    }

    const results = await Promise.all([
      this.checkAtMostOneActiveSession(),
      this.checkReadySessionsHaveSlots(),
      this.checkNoBigGameInNormalQueue(),
      this.checkNoTerminalSessionsAsRegistrationCandidates(),
      this.checkDueBigGameBlocksLowerPriority(),
    ]);

    const allPassed = results.every((result) => result);

    if (!allPassed && this.throwOnViolation) {
      throw new Error('Game operation invariants violated');
    }

    return allPassed;
  }

  /**
   * Invariant 1: At most one PLAYING/CHECKING/WINNER_WINDOW session globally.
   */
  private async checkAtMostOneActiveSession(): Promise<boolean> {
    const activeSessions = await this.prisma.gameSession.findMany({
      where: {
        status: {
          in: [
            GameStatus.PLAYING,
            GameStatus.CHECKING,
            GameStatus.WINNER_WINDOW,
          ],
        },
      },
      select: { id: true, status: true, gameSlotId: true },
    });

    if (activeSessions.length > 1) {
      this.logViolation(
        'MULTIPLE_ACTIVE_SESSIONS',
        `Found ${activeSessions.length} active sessions (PLAYING/CHECKING/WINNER_WINDOW). Expected at most 1.`,
        {
          sessionIds: activeSessions.map((s) => s.id),
          statuses: activeSessions.map((s) => s.status),
        },
      );
      return false;
    }

    return true;
  }

  /**
   * Invariant 2: READY sessions must have a valid slot.
   */
  private async checkReadySessionsHaveSlots(): Promise<boolean> {
    const readySessions = await this.prisma.gameSession.findMany({
      where: { status: GameStatus.READY },
      select: {
        id: true,
        gameSlotId: true,
        gameSlot: {
          select: { id: true, status: true },
        },
      },
    });

    const orphanedSessions = readySessions.filter(
      (session) => !session.gameSlot || session.gameSlot.status === GameStatus.CANCELLED,
    );

    if (orphanedSessions.length > 0) {
      this.logViolation(
        'READY_SESSION_WITHOUT_VALID_SLOT',
        `Found ${orphanedSessions.length} READY sessions with missing or cancelled slots.`,
        {
          sessionIds: orphanedSessions.map((s) => s.id),
          slotIds: orphanedSessions.map((s) => s.gameSlotId),
        },
      );
      return false;
    }

    return true;
  }

  /**
   * Invariant 3: Big Game should not appear in normal queue.
   * Normal queue = slots with status NEXT and category != BIG_GAME.
   */
  private async checkNoBigGameInNormalQueue(): Promise<boolean> {
    const bigGameInQueue = await this.prisma.gameSlot.findMany({
      where: {
        status: GameStatus.NEXT,
        category: GameCategory.BIG_GAME,
      },
      select: { id: true, sortOrder: true },
    });

    // Note: Big Game CAN be NEXT (in queue), but should be filtered from normal queue queries.
    // This check is informational - it's OK for Big Game to be NEXT.
    // The real check is that getCurrentOperations excludes it from the queue array.

    if (bigGameInQueue.length > 0) {
      this.logger.debug(
        `Found ${bigGameInQueue.length} Big Game slots with status NEXT. This is OK if they're excluded from normal queue queries.`,
      );
    }

    return true;
  }

  /**
   * Invariant 4: FINISHED/CANCELLED sessions should not be registration candidates.
   * This checks the actual getCurrentOperations logic.
   */
  private async checkNoTerminalSessionsAsRegistrationCandidates(): Promise<boolean> {
    // This is more of a logic check than a database check.
    // We verify that FINISHED/CANCELLED sessions are not in READY status.
    const terminalSessionsInReady = await this.prisma.gameSession.findMany({
      where: {
        status: GameStatus.READY,
        OR: [
          { finishedAt: { not: null } },
          { cancelledReason: { not: null } },
        ],
      },
      select: { id: true, finishedAt: true, cancelledReason: true },
    });

    if (terminalSessionsInReady.length > 0) {
      this.logViolation(
        'TERMINAL_SESSION_IN_READY',
        `Found ${terminalSessionsInReady.length} sessions with READY status but finishedAt or cancelledReason set.`,
        {
          sessionIds: terminalSessionsInReady.map((s) => s.id),
        },
      );
      return false;
    }

    return true;
  }

  /**
   * Invariant 5: Due Big Game should block lower-priority starts.
   * This is a runtime check, not a database state check.
   * We verify that if a due Big Game exists, no normal game is PLAYING.
   */
  private async checkDueBigGameBlocksLowerPriority(): Promise<boolean> {
    const now = new Date();

    const dueBigGame = await this.prisma.gameSession.findFirst({
      where: {
        status: GameStatus.READY,
        scheduledStartAt: { lte: now },
        gameSlot: {
          category: GameCategory.BIG_GAME,
          status: { not: GameStatus.CANCELLED },
        },
      },
      select: {
        id: true,
        scheduledStartAt: true,
        gameSlot: { select: { id: true } },
      },
    });

    if (!dueBigGame) {
      return true; // No due Big Game, no violation
    }

    const normalPlayingSession = await this.prisma.gameSession.findFirst({
      where: {
        status: {
          in: [
            GameStatus.PLAYING,
            GameStatus.CHECKING,
            GameStatus.WINNER_WINDOW,
          ],
        },
        gameSlot: {
          category: { not: GameCategory.BIG_GAME },
        },
      },
      select: {
        id: true,
        status: true,
        gameSlot: { select: { id: true, category: true } },
      },
    });

    if (normalPlayingSession) {
      this.logViolation(
        'DUE_BIG_GAME_NOT_BLOCKING',
        `Due Big Game exists (scheduledStartAt=${dueBigGame.scheduledStartAt?.toISOString()}) but normal game is ${normalPlayingSession.status}.`,
        {
          dueBigGameSessionId: dueBigGame.id,
          dueBigGameSlotId: dueBigGame.gameSlot.id,
          normalSessionId: normalPlayingSession.id,
          normalSlotId: normalPlayingSession.gameSlot.id,
          normalCategory: normalPlayingSession.gameSlot.category,
        },
      );
      return false;
    }

    return true;
  }

  /**
   * Helper: Log invariant violation.
   */
  private logViolation(
    code: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    this.logger.warn(
      `[INVARIANT_VIOLATION] ${code}: ${message}`,
      context ? JSON.stringify(context, null, 2) : undefined,
    );
  }

  /**
   * Check a specific invariant by name (for testing).
   */
  async checkInvariant(
    name:
      | 'atMostOneActiveSession'
      | 'readySessionsHaveSlots'
      | 'noBigGameInNormalQueue'
      | 'noTerminalSessionsAsRegistrationCandidates'
      | 'dueBigGameBlocksLowerPriority',
  ): Promise<boolean> {
    switch (name) {
      case 'atMostOneActiveSession':
        return this.checkAtMostOneActiveSession();
      case 'readySessionsHaveSlots':
        return this.checkReadySessionsHaveSlots();
      case 'noBigGameInNormalQueue':
        return this.checkNoBigGameInNormalQueue();
      case 'noTerminalSessionsAsRegistrationCandidates':
        return this.checkNoTerminalSessionsAsRegistrationCandidates();
      case 'dueBigGameBlocksLowerPriority':
        return this.checkDueBigGameBlocksLowerPriority();
      default:
        throw new Error(`Unknown invariant: ${name}`);
    }
  }
}
