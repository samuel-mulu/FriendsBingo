import { BadRequestException } from '@nestjs/common';
import { GameOperationMode, GameStatus } from '@prisma/client';

export {
  DEFAULT_AUTO_CALL_INTERVAL_SECONDS,
  DEFAULT_REGISTRATION_DURATION_SECONDS,
} from '../game-timing-config/game-timing-config.defaults';

export function canRegisterForOperationMode(
  operationMode: GameOperationMode,
  sessionStatus: GameStatus,
  scheduledStartAt?: Date | null,
): boolean {
  if (sessionStatus === GameStatus.READY) {
    // AUTO registration closes the moment the countdown deadline passes,
    // even if the scheduler tick has not yet started/cancelled the session.
    if (
      operationMode === GameOperationMode.AUTO &&
      scheduledStartAt != null &&
      scheduledStartAt.getTime() <= Date.now()
    ) {
      return false;
    }
    return true;
  }

  if (
    sessionStatus === GameStatus.PLAYING &&
    operationMode === GameOperationMode.MANUAL
  ) {
    return true;
  }

  return false;
}

export function canRegisterForBigGameWindow(
  registrationOpensAt?: Date | null,
  scheduledStartAt?: Date | null,
  now: Date = new Date(),
): boolean {
  if (!registrationOpensAt || !scheduledStartAt) {
    return false;
  }

  const nowMs = now.getTime();
  return (
    registrationOpensAt.getTime() <= nowMs && nowMs < scheduledStartAt.getTime()
  );
}

export function assertBigGameRegistrationAllowed(
  registrationOpensAt?: Date | null,
  scheduledStartAt?: Date | null,
  now: Date = new Date(),
): void {
  if (
    registrationOpensAt == null ||
    now.getTime() < registrationOpensAt.getTime()
  ) {
    throw new BadRequestException({
      message: 'Big Game registration is not open yet',
      code: 'BIG_GAME_REGISTRATION_NOT_OPEN',
    });
  }

  if (scheduledStartAt == null || now.getTime() >= scheduledStartAt.getTime()) {
    throw new BadRequestException({
      message: 'Big Game registration is closed',
      code: 'BIG_GAME_REGISTRATION_CLOSED',
    });
  }
}

export function assertRegistrationAllowed(
  operationMode: GameOperationMode,
  sessionStatus: GameStatus,
  scheduledStartAt?: Date | null,
): void {
  if (
    !canRegisterForOperationMode(operationMode, sessionStatus, scheduledStartAt)
  ) {
    throw new BadRequestException({
      message: 'Cartela registration is closed for this game',
      code: 'REGISTRATION_CLOSED',
    });
  }
}
