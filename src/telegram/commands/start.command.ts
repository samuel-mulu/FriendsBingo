import { Context } from 'grammy';
import { getMainMenuKeyboard } from '../keyboards/main-menu.keyboard';

export async function handleStartCommand(
  ctx: Context,
  miniappUrl?: string,
): Promise<void> {
  const firstName = ctx.from?.first_name || 'Friend';
  const startParam =
    typeof ctx.match === 'string' && ctx.match.trim().length > 0
      ? ctx.match.trim()
      : undefined;
  const isAmharic = ctx.from?.language_code?.toLowerCase().startsWith('am');

  const welcomeMessageEn = `
🎉 *Welcome to Friends Bingo, ${firstName}!*

Experience real-time Ethiopian multiplayer Bingo directly inside Telegram!

✨ *Features:*
• 🏆 Real cash prize pools & instant payouts
• 💳 Instant deposits with Telebirr, CBE, Awash & BOA
• 🔢 Live ball drawing with sound and auto-mark
• ⚡ Fast, secure, and authenticated with Telegram

Tap the button below to join the active game lobby!
`;

  const welcomeMessageAm = `
🎉 *እንኳን ወደ ፍሬንድስ ቢንጎ በደህና መጡ፣ ${firstName}!*

በቴሌግራም በቀጥታ የሚጫወቱት የኢትዮጵያ የቀጥታ የቢንጎ ጨዋታ!

✨ *ባህሪያት:*
• 🏆 እውነተኛ የገንዘብ ሽልማት እና ፈጣን ክፍያ
• 💳 በቴሌብር፣ ንግድ ባንክ፣ አዋሽ እና አቢሲኒያ ፈጣን ተቀማጭ
• 🔢 የቀጥታ የቁጥር እጣ ከድምፅ እና አውቶ-ማርክ ጋር
• ⚡ ፈጣን፣ አስተማማኝ እና በቴሌግራም የተረጋገጠ

ለመጫወት ከታች ያለውን ቁልፍ ይጫኑ!
`;

  await ctx.reply(isAmharic ? welcomeMessageAm : welcomeMessageEn, {
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard(
      miniappUrl,
      startParam,
      isAmharic ? 'am' : 'en',
    ),
  });
}
