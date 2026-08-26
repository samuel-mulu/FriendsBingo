import { WinnerPhoneDisplayMode } from '@prisma/client';

export const APP_DISPLAY_CONFIG_ID = 'default';

export const DEFAULT_WINNER_PHONE_DISPLAY_MODE = WinnerPhoneDisplayMode.HIDDEN;

export const WINNER_PHONE_DISPLAY_MODES = [
  WinnerPhoneDisplayMode.HIDDEN,
  WinnerPhoneDisplayMode.FULL,
  WinnerPhoneDisplayMode.MASKED,
] as const;
