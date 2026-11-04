import { WinnerPhoneDisplayMode } from '@prisma/client';

export const APP_DISPLAY_CONFIG_ID = 'default';

export const DEFAULT_WINNER_PHONE_DISPLAY_MODE = WinnerPhoneDisplayMode.HIDDEN;

export const DEFAULT_BIG_GAME_PROMOTION_CARD_ENABLED = true;

/** Last-second Bingo lock is off until an admin turns it on. */
export const DEFAULT_BINGO_CLAIM_LAST_SECOND_LOCK_ENABLED = false;

export const WINNER_PHONE_DISPLAY_MODES = [
  WinnerPhoneDisplayMode.HIDDEN,
  WinnerPhoneDisplayMode.FULL,
  WinnerPhoneDisplayMode.MASKED,
] as const;
