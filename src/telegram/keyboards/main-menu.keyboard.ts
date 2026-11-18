import { InlineKeyboard } from 'grammy';
import { BOT_CALLBACK_QUERIES } from '../telegram.constants';
import {
  buildMiniappPathUrl,
  buildMiniappStartUrl,
} from '../telegram-formatting.util';

export function getMainMenuKeyboard(
  miniappUrl?: string,
  startParam?: string,
  lang: 'en' | 'am' = 'en',
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const playLabel =
    lang === 'am' ? '🎮 ፍሬንድስ ቢንጎ ተጫወት' : '🎮 Play Friends Bingo';
  const gamesLabel = lang === 'am' ? '🎲 ክፍት ጨዋታዎች' : '🎲 Open Games';
  const walletLabel =
    lang === 'am' ? '💰 ዋሌት እና ገንዘብ ማስገቢያ' : '💰 Wallet & Deposits';
  const rulesLabel = lang === 'am' ? 'ℹ️ የጨዋታው ሕጎች' : 'ℹ️ Rules & How to Play';

  if (miniappUrl) {
    const playUrl = buildMiniappStartUrl(miniappUrl, startParam);
    const walletUrl = buildMiniappPathUrl(miniappUrl, '/wallet');

    keyboard.webApp(playLabel, playUrl);
    keyboard.row();
    keyboard.webApp(walletLabel, walletUrl);
    keyboard.text(gamesLabel, BOT_CALLBACK_QUERIES.GAMES);
    keyboard.row();
    keyboard.text(rulesLabel, BOT_CALLBACK_QUERIES.HELP);
  } else {
    // Fallback if Mini App URL is not yet configured in environment
    keyboard.text(playLabel, BOT_CALLBACK_QUERIES.PLAY);
    keyboard.row();
    keyboard.text(gamesLabel, BOT_CALLBACK_QUERIES.GAMES);
    keyboard.text(walletLabel, BOT_CALLBACK_QUERIES.WALLET);
    keyboard.row();
    keyboard.text(rulesLabel, BOT_CALLBACK_QUERIES.HELP);
  }

  return keyboard;
}
