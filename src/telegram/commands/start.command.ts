import { Context } from 'grammy';
import { getMainMenuKeyboard } from '../keyboards/main-menu.keyboard';
import { escapeTelegramHtml } from '../telegram-formatting.util';

export async function handleStartCommand(
  ctx: Context,
  miniappUrl?: string,
): Promise<void> {
  const firstName = escapeTelegramHtml(ctx.from?.first_name || 'Friend');
  const startParam =
    typeof ctx.match === 'string' && ctx.match.trim().length > 0
      ? ctx.match.trim()
      : undefined;
  const isAmharic = ctx.from?.language_code?.toLowerCase().startsWith('am');

  const welcomeMessageEn = `
🎉 <b>Welcome to Friends Bingo, ${firstName}!</b>

Experience real-time Ethiopian multiplayer Bingo directly inside Telegram!

✨ <b>Features:</b>
• 🏆 Real cash prize pools &amp; instant payouts
• 💳 Instant deposits with Telebirr, CBE, Awash &amp; BOA
• 🔢 Live ball drawing with sound and auto-mark
• ⚡ Fast, secure, and authenticated with Telegram

Tap the button below to join the active game lobby!
`;

  const welcomeMessageAm = `
🎉 <b>እንኳን ወደ ፍሬንድስ ቢንጎ በደህና መጡ፣ ${firstName}!</b>

በቴሌግራም በቀጥታ የሚጫወቱት የኢትዮጵያ የቀጥታ የቢንጎ ጨዋታ!

✨ <b>ባህሪያት:</b>
• 🏆 እውነተኛ የገንዘብ ሽልማት እና ፈጣን ክፍያ
• 💳 በቴሌብር፣ ንግድ ባንክ፣ አዋሽ እና አቢሲኒያ ፈጣን ተቀማጭ
• 🔢 የቀጥታ የቁጥር እጣ ከድምፅ እና አውቶ-ማርክ ጋር
• ⚡ ፈጣን፣ አስተማማኝ እና በቴሌግራም የተረጋገጠ

ለመጫወት ከታች ያለውን ቁልፍ ይጫኑ!
`;

  await ctx.reply(isAmharic ? welcomeMessageAm : welcomeMessageEn, {
    parse_mode: 'HTML',
    reply_markup: getMainMenuKeyboard(
      miniappUrl,
      startParam,
      isAmharic ? 'am' : 'en',
    ),
  });
}
