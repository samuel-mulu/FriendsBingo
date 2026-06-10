import { BadRequestException } from '@nestjs/common';
import { GameOperationMode, GameStatus } from '@prisma/client';

export const DEFAULT_REGISTRATION_DURATION_SECONDS = 60;
export const DEFAULT_AUTO_CALL_INTERVAL_SECONDS = 7;

export function canRegisterForOperationMode(
  operationMode: GameOperationMode,
  sessionStatus: GameStatus,
): boolean {
  if (sessionStatus === GameStatus.READY) {
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

export function assertRegistrationAllowed(
  operationMode: GameOperationMode,
  sessionStatus: GameStatus,
): void {
  if (!canRegisterForOperationMode(operationMode, sessionStatus)) {
    throw new BadRequestException(
      'Cartela registration is closed for this game',
    );
  }
}
