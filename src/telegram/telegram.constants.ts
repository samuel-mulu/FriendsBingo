export const TELEGRAM_BOT_TOKEN_KEY = 'TELEGRAM_BOT_TOKEN';
export const TELEGRAM_BOT_USERNAME_KEY = 'TELEGRAM_BOT_USERNAME';
export const TELEGRAM_WEBHOOK_SECRET_KEY = 'TELEGRAM_WEBHOOK_SECRET';
export const TELEGRAM_MINIAPP_URL_KEY = 'TELEGRAM_MINIAPP_URL';
export const TELEGRAM_BOT_POLLING_KEY = 'TELEGRAM_BOT_POLLING';

export const BOT_CALLBACK_QUERIES = {
  PLAY: 'cmd_play',
} as const;

/**
 * Bot commands registered with Telegram Bot API via setup CLI (English).
 * The bot's sole responsibility is launching/opening the Mini App.
 */
export const TELEGRAM_BOT_COMMANDS_EN = [
  { command: 'start', description: 'Open Friends Bingo' },
  { command: 'play', description: 'Launch Friends Bingo App' },
] as const;

/**
 * Bot commands registered with Telegram Bot API via setup CLI (Amharic).
 * The bot's sole responsibility is launching/opening the Mini App.
 */
export const TELEGRAM_BOT_COMMANDS_AM = [
  { command: 'start', description: 'ፍሬንድስ ቢንጎን ክፈት' },
  { command: 'play', description: 'የቢንጎ ጨዋታውን ጀምር' },
] as const;

/** Chat menu button text (persistent launcher button). */
export const TELEGRAM_MENU_BUTTON_TEXT = '🎮 Play Bingo';
