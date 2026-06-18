export type GameTimingConfigRecord = {
  id: string;
  registrationDurationSeconds: number;
  autoCallIntervalSeconds: number;
  winnerWindowSeconds: number;
  winnerWindowClaimGraceMs: number;
  cartelaHoldSeconds: number;
  finishedResultDisplaySeconds: number;
  winningPatternDisplaySeconds: number;
  preparingDisplayMaxSeconds: number | null;
  missedNumberAnimationMs: number;
  missedNumberStaggerMaxBalls: number;
  adminRefreshDebounceMs: number;
  adminFallbackPollingSeconds: number;
  flutterRefetchDebounceMs: number;
  updatedAt: Date;
  updatedById: string | null;
};

export type AdminGameTimingConfigResponse = GameTimingConfigRecord;

export type PlayerGameTimingConfigResponse = {
  registrationDurationSeconds: number;
  autoCallIntervalSeconds: number;
  winnerWindowSeconds: number;
  cartelaHoldSeconds: number;
  finishedResultDisplaySeconds: number;
  winningPatternDisplaySeconds: number;
  preparingDisplayMaxSeconds: number | null;
  missedNumberAnimationMs: number;
  missedNumberStaggerMaxBalls: number;
  flutterRefetchDebounceMs: number;
  serverNow: string;
};
