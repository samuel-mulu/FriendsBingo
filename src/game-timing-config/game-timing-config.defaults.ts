export const GAME_TIMING_CONFIG_ID = 'default';

export const DEFAULT_REGISTRATION_DURATION_SECONDS = 180;
export const DEFAULT_AUTO_CALL_INTERVAL_SECONDS = 15;
export const DEFAULT_AUTO_CALL_INTERVAL_MS =
  DEFAULT_AUTO_CALL_INTERVAL_SECONDS * 1000;
export const DEFAULT_WINNER_WINDOW_SECONDS = 25;
export const DEFAULT_WINNER_WINDOW_DURATION_MS =
  DEFAULT_WINNER_WINDOW_SECONDS * 1000;
export const DEFAULT_WINNER_WINDOW_CLAIM_GRACE_MS = 750;
export const DEFAULT_CARTELA_HOLD_SECONDS = 10;
export const DEFAULT_FINISHED_RESULT_DISPLAY_SECONDS = 60;
export const DEFAULT_WINNING_PATTERN_DISPLAY_SECONDS = 10;
export const DEFAULT_MISSED_NUMBER_ANIMATION_MS = 150;
export const DEFAULT_MISSED_NUMBER_STAGGER_MAX_BALLS = 10;
export const DEFAULT_ADMIN_REFRESH_DEBOUNCE_MS = 2500;
export const DEFAULT_ADMIN_FALLBACK_POLLING_SECONDS = 5;
export const DEFAULT_FLUTTER_REFETCH_DEBOUNCE_MS = 400;

export const GAME_TIMING_BOUNDS = {
  registrationDurationSeconds: { min: 10, max: 600 },
  autoCallIntervalSeconds: { min: 3, max: 60 },
  winnerWindowSeconds: { min: 5, max: 120 },
  winnerWindowClaimGraceMs: { min: 0, max: 2000 },
  cartelaHoldSeconds: { min: 5, max: 30 },
  finishedResultDisplaySeconds: { min: 1, max: 120 },
  winningPatternDisplaySeconds: { min: 3, max: 30 },
  preparingDisplayMaxSeconds: { min: 5, max: 120 },
  missedNumberAnimationMs: { min: 50, max: 2000 },
  missedNumberStaggerMaxBalls: { min: 1, max: 75 },
  adminRefreshDebounceMs: { min: 500, max: 30_000 },
  adminFallbackPollingSeconds: { min: 1, max: 60 },
  flutterRefetchDebounceMs: { min: 100, max: 5000 },
} as const;
