import { Context, InlineKeyboard } from 'grammy';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildMiniappPathUrl,
  escapeTelegramHtml,
} from '../telegram-formatting.util';

export async function handleWalletCommand(
  ctx: Context,
  prisma: PrismaService,
  miniappUrl?: string,
): Promise<void> {
  const isAmharic = ctx.from?.language_code?.toLowerCase().startsWith('am');
  const telegramId = ctx.from?.id ? String(ctx.from.id) : null;

  let balanceText = '';
  let isLinked = false;

  if (telegramId) {
    try {
      const user = await prisma.user.findUnique({
        where: { telegramId },
        include: { wallet: true },
      });

      if (user && user.wallet) {
        isLinked = true;
        const balance = Number(user.wallet.balance).toFixed(2);
        const bonus = user.wallet.bonusCartelaBalance;

        balanceText = isAmharic
          ? `\n💰 <b>ያለዎት ቀሪ ሂሳብ:</b> <code>${balance} ETB</code>\n🎁 <b>ቦነስ ካርቴላ:</b> <code>${bonus}</code>\n`
          : `\n💰 <b>Current Balance:</b> <code>${balance} ETB</code>\n🎁 <b>Bonus Cartelas:</b> <code>${bonus}</code>\n`;
      }
    } catch {
      // Ignore DB query errors and show default text
    }
  }

  const walletUrl = miniappUrl
    ? buildMiniappPathUrl(miniappUrl, '/wallet')
    : undefined;
  const playUrl = miniappUrl || undefined;

  const keyboard = new InlineKeyboard();

  if (walletUrl) {
    keyboard.webApp(
      isAmharic ? '💳 ዋሌት ክፈት እና ገንዘብ አስገባ' : '💳 Open Wallet & Deposit',
      walletUrl,
    );
    keyboard.row();
    keyboard.webApp(
      isAmharic ? '🎮 ቢንጎ ተጫወት' : '🎮 Play Bingo',
      playUrl!,
    );
  }

  // Unlinked Telegram Visitor notice
  const unlinkNoticeEn = `
ℹ️ Your Telegram account is not yet linked to a Friends Bingo account.
Tap <b>Open Wallet &amp; Deposit</b> below to link your phone number and start playing!
`;
  const unlinkNoticeAm = `
ℹ️ የቴሌግራም ሂሳብዎ ከፍሬንድስ ቢንጎ ሂሳብ ጋር አልተገናኘም።
ስልክ ቁጥርዎን ለማገናኘት እና ለመጫወት ከታች <b>ዋሌት ክፈት እና ገንዘብ አስገባ</b>ን ይጫኑ!
`;

  const walletInfoEn = `
💼 <b>Friends Bingo Wallet</b>
${isLinked ? balanceText : unlinkNoticeEn}
• Top-up instantly via <b>Telebirr</b>, <b>CBE Birr</b>, <b>Awash Bank</b>, or <b>Bank of Abyssinia</b>.
• Fast withdrawal processing to your bank or mobile wallet.
• View real-time transactions and game earnings.

Open your wallet below to manage funds:
`;

  const walletInfoAm = `
💼 <b>የፍሬንድስ ቢንጎ ዋሌት</b>
${isLinked ? balanceText : unlinkNoticeAm}
• በ<b>ቴሌብር</b>፣ በ<b>ንግድ ባንክ</b>፣ በ<b>አዋሽ ባንክ</b> ወይም በ<b>አቢሲኒያ ባንክ</b> በፍጥነት ገንዘብ ያስገቡ።
• ያሸነፉትን ገንዘብ ወዲያውኑ ወደ ባንክ ሂሳብዎ ወይም ሞባይል ዋሌትዎ ማውጣት ይችላሉ።
• የግብይት ታሪክዎን እና የጨዋታ አሸናፊነትዎን በቅጽበት ይመልከቱ።

ሂሳብዎን ለማስተዳደር ከታች ያለውን ይጫኑ:
`;

  await ctx.reply(isAmharic ? walletInfoAm : walletInfoEn, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}
