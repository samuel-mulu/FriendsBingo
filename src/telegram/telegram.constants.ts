export const TELEGRAM_BOT_TOKEN_KEY = 'TELEGRAM_BOT_TOKEN';
export const TELEGRAM_BOT_USERNAME_KEY = 'TELEGRAM_BOT_USERNAME';
export const TELEGRAM_WEBHOOK_SECRET_KEY = 'TELEGRAM_WEBHOOK_SECRET';
export const TELEGRAM_MINIAPP_URL_KEY = 'TELEGRAM_MINIAPP_URL';
export const TELEGRAM_BOT_POLLING_KEY = 'TELEGRAM_BOT_POLLING';

export const BOT_CALLBACK_QUERIES = {
  HELP: 'cmd_help',
  PLAY: 'cmd_play',
  GAMES: 'cmd_games',
  WALLET: 'cmd_wallet',
} as const;

/** Bot commands registered via setup CLI (English). */
export const TELEGRAM_BOT_COMMANDS_EN = [
  { command: 'start', description: 'Start Friends Bingo & view lobby' },
  { command: 'play', description: 'Launch real-time multiplayer Bingo' },
  { command: 'games', description: 'View active game rooms & slots' },
  { command: 'wallet', description: 'Check balance, deposits & withdrawals' },
  { command: 'rules', description: 'Game rules and winning patterns' },
  { command: 'help', description: 'Assistance & customer support' },
] as const;

/** Bot commands registered via setup CLI (Amharic). */
export const TELEGRAM_BOT_COMMANDS_AM = [
  { command: 'start', description: 'ፍሬንድስ ቢንጎን ጀምር' },
  { command: 'play', description: 'የቀጥታ ቢንጎ ተጫወት' },
  { command: 'games', description: 'ክፍት ጨዋታዎችን ተመልከት' },
  { command: 'wallet', description: 'ዋሌት እና ገንዘብ ማስገቢያ' },
  { command: 'rules', description: 'የጨዋታው ሕጎች እና መመሪያ' },
  { command: 'help', description: 'የእርዳታ እና ድጋፍ አገልግሎት' },
] as const;

/** Chat menu button text. */
export const TELEGRAM_MENU_BUTTON_TEXT = '🎮 Play Bingo';
