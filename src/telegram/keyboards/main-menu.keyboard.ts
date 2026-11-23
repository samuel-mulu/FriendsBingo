import { InlineKeyboard } from 'grammy';
import { BOT_CALLBACK_QUERIES } from '../telegram.constants';
import { buildMiniappStartUrl } from '../telegram-formatting.util';

/**
 * Returns a focused, single-purpose inline keyboard that launches the
 * Friends Bingo Telegram Mini App directly inside Telegram.
 */
export function getMainMenuKeyboard(
  miniappUrl?: string,
  startParam?: string,
  lang: 'en' | 'am' = 'en',
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const playLabel =
    lang === 'am' ? '🎮 ፍሬንድስ ቢንጎን ክፈት' : '🎮 Play Friends Bingo';

  if (miniappUrl) {
    const playUrl = buildMiniappStartUrl(miniappUrl, startParam);
    keyboard.webApp(playLabel, playUrl);
  } else {
    // Fallback if Mini App URL is not yet configured in environment
    keyboard.text(playLabel, BOT_CALLBACK_QUERIES.PLAY);
  }

  return keyboard;
}
