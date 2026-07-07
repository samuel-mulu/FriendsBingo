import { Injectable, Logger } from '@nestjs/common';
import { GameCategory, GameOperationMode, GameStatus } from '@prisma/client';

/**
 * Debug logger for game operations lifecycle.
 * Only logs when GAME_LIFECYCLE_DEBUG=true or NODE_ENV=development.
 * 
 * Purpose: Make the game operations flow explicit and easier to debug.
 * Logs all session creation, status transitions, queue operations, and registration events.
 * 
 * Does NOT log personal data (user IDs, wallet amounts, etc).
 */
@Injectable()
export class GameLifecycleDebugLogger {
  private readonly logger = new Logger('GameFlow');
  private readonly enabled: boolean;

  constructor() {
    this.enabled =
      process.env.GAME_LIFECYCLE_DEBUG === 'true' ||
      process.env.NODE_ENV === 'development';
  }

  sessionCreated(params: {
    sessionId: string;
    slotId: string;
    slotStatus: GameStatus;
    sessionStatus: GameStatus;
    category: GameCategory;
    operationMode: GameOperationMode;
    reason:
      | 'post_game_opener'
      | 'first_registration'
      | 'admin_create_slot'
      | 'admin_start_manual'
      | 'admin_switch_mode';
    scheduledStartAt?: Date | null;
  }) {
    if (!this.enabled) return;

    this.logger.log(
      [
        'event=session_created',
        `slotId=${params.slotId}`,
        `sessionId=${params.sessionId}`,
        `slotStatus=${params.slotStatus}`,
        `sessionStatus=${params.sessionStatus}`,
        `category=${params.category}`,
        `operationMode=${params.operationMode}`,
        `reason=${params.reason}`,
        params.scheduledStartAt
          ? `scheduledStartAt=${params.scheduledStartAt.toISOString()}`
          : null,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  sessionStatusChanged(params: {
    sessionId: string;
    slotId: string;
    fromStatus: GameStatus;
    toStatus: GameStatus;
    reason:
      | 'admin_start'
      | 'auto_start'
      | 'bingo_claim'
      | 'bingo_valid'
      | 'bingo_invalid'
      | 'winner_finalize'
      | 'admin_cancel'
      | 'auto_cancel_empty';
  }) {
    if (!this.enabled) return;

    this.logger.log(
      [
        'event=session_status_changed',
        `sessionId=${params.sessionId}`,
        `slotId=${params.slotId}`,
        `from=${params.fromStatus}`,
        `to=${params.toStatus}`,
        `reason=${params.reason}`,
      ].join(' '),
    );
  }

  slotStatusChanged(params: {
    slotId: string;
    fromStatus: GameStatus;
    toStatus: GameStatus;
    reason:
      | 'session_started'
      | 'session_finished'
      | 'session_cancelled'
      | 'queue_restore'
      | 'admin_update';
    sessionId?: string;
  }) {
    if (!this.enabled) return;

    this.logger.log(
      [
        'event=slot_status_changed',
        `slotId=${params.slotId}`,
        `from=${params.fromStatus}`,
        `to=${params.toStatus}`,
        `reason=${params.reason}`,
        params.sessionId ? `sessionId=${params.sessionId}` : null,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  registrationOpened(params: {
    sessionId: string;
    slotId: string;
    category: GameCategory;
    operationMode: GameOperationMode;
    scheduledStartAt?: Date | null;
    reason:
      | 'scheduler_tick'
      | 'first_player_registration'
      | 'admin_action'
      | 'deferred_behind_live'
      | 'existing_ready_activated';
  }) {
    if (!this.enabled) return;

    this.logger.log(
      [
        'event=registration_opened',
        `sessionId=${params.sessionId}`,
        `slotId=${params.slotId}`,
        `category=${params.category}`,
        `operationMode=${params.operationMode}`,
        `reason=${params.reason}`,
        params.scheduledStartAt
          ? `scheduledStartAt=${params.scheduledStartAt.toISOString()}`
          : null,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  gameStarted(params: {
    sessionId: string;
    slotId: string;
    category: GameCategory;
    operationMode: GameOperationMode;
    reason: 'admin_manual' | 'scheduler_auto';
    hadReadySession: boolean;
  }) {
    if (!this.enabled) return;

    this.logger.log(
      [
        'event=game_started',
        `sessionId=${params.sessionId}`,
        `slotId=${params.slotId}`,
        `category=${params.category}`,
        `operationMode=${params.operationMode}`,
        `reason=${params.reason}`,
        `hadReadySession=${params.hadReadySession}`,
      ].join(' '),
    );
  }

  queueRestored(params: {
    slotId: string;
    result: 'requeued' | 'removed';
    newSortOrder?: number;
    reason: 'session_finished' | 'session_cancelled';
  }) {
    if (!this.enabled) return;

    this.logger.log(
      [
        'event=queue_restored',
        `slotId=${params.slotId}`,
        `result=${params.result}`,
        params.newSortOrder ? `newSortOrder=${params.newSortOrder}` : null,
        `reason=${params.reason}`,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  registrationCandidateSelected(params: {
    kind: 'ready_session' | 'next_slot' | 'none';
    slotId?: string;
    sessionId?: string;
    category?: GameCategory;
    sortOrder?: number;
  }) {
    if (!this.enabled) return;

    this.logger.log(
      [
        'event=registration_candidate_selected',
        `kind=${params.kind}`,
        params.slotId ? `slotId=${params.slotId}` : null,
        params.sessionId ? `sessionId=${params.sessionId}` : null,
        params.category ? `category=${params.category}` : null,
        params.sortOrder !== undefined ? `sortOrder=${params.sortOrder}` : null,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  currentOperationsBuilt(params: {
    hasLiveGame: boolean;
    hasCheckingGame: boolean;
    hasRegistrationOpenGame: boolean;
    queueLength: number;
    liveSessionId?: string;
    checkingSessionId?: string;
    registrationSessionId?: string;
    registrationSlotId?: string;
  }) {
    if (!this.enabled) return;

    this.logger.log(
      [
        'event=current_operations_built',
        `hasLive=${params.hasLiveGame}`,
        `hasChecking=${params.hasCheckingGame}`,
        `hasRegistration=${params.hasRegistrationOpenGame}`,
        `queueLength=${params.queueLength}`,
        params.liveSessionId ? `liveSessionId=${params.liveSessionId}` : null,
        params.checkingSessionId
          ? `checkingSessionId=${params.checkingSessionId}`
          : null,
        params.registrationSessionId
          ? `registrationSessionId=${params.registrationSessionId}`
          : null,
        params.registrationSlotId
          ? `registrationSlotId=${params.registrationSlotId}`
          : null,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  schedulerTick(params: {
    dueSessionsCount: number;
    willOpenRegistration: boolean;
    activeSessionExists: boolean;
    recentFinishedExists: boolean;
    dueBigGameExists: boolean;
  }) {
    if (!this.enabled) return;

    this.logger.log(
      [
        'event=scheduler_tick',
        `dueSessionsCount=${params.dueSessionsCount}`,
        `willOpenRegistration=${params.willOpenRegistration}`,
        `activeSessionExists=${params.activeSessionExists}`,
        `recentFinishedExists=${params.recentFinishedExists}`,
        `dueBigGameExists=${params.dueBigGameExists}`,
      ].join(' '),
    );
  }

  queueHeadSelected(params: {
    slotId: string;
    category: GameCategory;
    sortOrder: number;
    operationMode: GameOperationMode;
    reason: 'registration_open' | 'auto_start_check';
  }) {
    if (!this.enabled) return;

    this.logger.log(
      [
        'event=queue_head_selected',
        `slotId=${params.slotId}`,
        `category=${params.category}`,
        `sortOrder=${params.sortOrder}`,
        `operationMode=${params.operationMode}`,
        `reason=${params.reason}`,
      ].join(' '),
    );
  }

  dueBigGameBlocked(params: {
    bigGameSlotId: string;
    bigGameScheduledStartAt: Date;
    attemptedSlotId: string;
  }) {
    if (!this.enabled) return;

    this.logger.log(
      [
        'event=due_big_game_blocked',
        `bigGameSlotId=${params.bigGameSlotId}`,
        `bigGameScheduledStartAt=${params.bigGameScheduledStartAt.toISOString()}`,
        `attemptedSlotId=${params.attemptedSlotId}`,
      ].join(' '),
    );
  }

  invalidReadySessionDetected(params: {
    sessionId: string;
    slotId: string;
    reason: string;
    slotStatus?: GameStatus;
    hasRegistrations: boolean;
  }) {
    if (!this.enabled) return;

    this.logger.warn(
      [
        'event=invalid_ready_session_detected',
        `sessionId=${params.sessionId}`,
        `slotId=${params.slotId}`,
        `reason=${params.reason}`,
        params.slotStatus ? `slotStatus=${params.slotStatus}` : null,
        `hasRegistrations=${params.hasRegistrations}`,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  invalidReadySessionRepaired(params: {
    sessionId: string;
    slotId: string;
    reason: string;
    hadRegistrations: boolean;
  }) {
    if (!this.enabled) return;

    this.logger.log(
      [
        'event=invalid_ready_session_repaired',
        `sessionId=${params.sessionId}`,
        `slotId=${params.slotId}`,
        `reason=${params.reason}`,
        `hadRegistrations=${params.hadRegistrations}`,
      ].join(' '),
    );
  }

  invalidSessionCreationBlocked(params: {
    slotId: string;
    reason: string;
    attemptedStatus: GameStatus;
  }) {
    if (!this.enabled) return;

    this.logger.warn(
      [
        'event=invalid_session_creation_blocked',
        `slotId=${params.slotId}`,
        `reason=${params.reason}`,
        `attemptedStatus=${params.attemptedStatus}`,
      ].join(' '),
    );
  }
}
