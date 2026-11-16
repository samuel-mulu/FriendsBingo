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
    ? '🎯 *ለመጫወት ዝግጁ ነዎት?* የቀጥታ ጨዋታውን ለመቀላቀል ከታች ያለውን ቁልፍ ይጫኑ!'
    : '🎯 *Ready to play?* Click below to enter the live game arena!';

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard(
      miniappUrl,
      startParam,
      isAmharic ? 'am' : 'en',
    ),
  });
}
