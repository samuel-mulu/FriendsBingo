import { Context } from 'grammy';
import { getMainMenuKeyboard } from '../keyboards/main-menu.keyboard';

export async function handlePlayCommand(
  ctx: Context,
  miniappUrl?: string,
): Promise<void> {
  const startParam =
    typeof ctx.match === 'string' && ctx.match.trim().length > 0
      ? ctx.match.trim()
      : undefined;
  const isAmharic = ctx.from?.language_code?.toLowerCase().startsWith('am');

  const text = isAmharic
    ? '🎮 <b>ለመጫወት ዝግጁ ነዎት?</b>\n\nየቀጥታ ጨዋታውን ለመቀላቀል እና አፑን ለመክፈት ከታች ያለውን ቁልፍ ይጫኑ!'
    : '🎮 <b>Ready to play Friends Bingo?</b>\n\nTap the button below to launch the app and enter the live game lobby!';

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: getMainMenuKeyboard(
      miniappUrl,
      startParam,
      isAmharic ? 'am' : 'en',
    ),
  });
}
