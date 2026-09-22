import { GameStatus } from '@prisma/client';

import { canRegisterForBigGameWindow } from './games.operation-mode';

export type BigGameRegistrationLeanSession = {
  id: string;
  status: GameStatus;
  roundIndex: number | null;
  registrationOpensAt: Date | null;
  scheduledStartAt: Date | null;
  gameSlot: { id: string };
};

export function pickBigGameRegistrationSessionLean<
  T extends BigGameRegistrationLeanSession,
>(
  sortedSessions: T[],
  resolvePrimary: (sorted: T[]) => T,
  canRegister: (session: T) => boolean,
): T | null {
  if (sortedSessions.length === 0) {
    return null;
  }

  const primary = resolvePrimary(sortedSessions);
  const primaryRound = primary.roundIndex ?? 1;
  const terminalStatuses: GameStatus[] = [
    GameStatus.FINISHED,
    GameStatus.NO_WINNER,
  ];

  const nextRoundReady = sortedSessions.find(
    (candidate) =>
      candidate.gameSlot.id === primary.gameSlot.id &&
      candidate.status === GameStatus.READY &&
      (candidate.roundIndex ?? 1) === primaryRound + 1,
  );

  if (
    nextRoundReady &&
    terminalStatuses.includes(primary.status) &&
    canRegister(nextRoundReady)
  ) {
    return nextRoundReady;
  }

  if (
    (primary.status === GameStatus.READY ||
      primary.status === GameStatus.NEXT) &&
    canRegister(primary)
  ) {
    return primary;
  }

  return null;
}

export function canRegisterBigGameLeanSession(
  session: BigGameRegistrationLeanSession,
  now: Date = new Date(),
): boolean {
  return (
    session.status === GameStatus.READY &&
    canRegisterForBigGameWindow(
      session.registrationOpensAt,
      session.scheduledStartAt,
      now,
    )
  );
}
