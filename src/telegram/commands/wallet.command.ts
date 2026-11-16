import { Context, InlineKeyboard } from 'grammy';
import { PrismaService } from '../../prisma/prisma.service';

export async function handleWalletCommand(
  ctx: Context,
  prisma: PrismaService,
  miniappUrl?: string,
): Promise<void> {
  const isAmharic = ctx.from?.language_code?.toLowerCase().startsWith('am');
  const telegramId = ctx.from?.id ? String(ctx.from.id) : null;

  let balanceText = '';

  if (telegramId) {
    try {
      const user = await prisma.user.findUnique({
        where: { telegramId },
        include: { wallet: true },
      });

      if (user && user.wallet) {
        const balance = Number(user.wallet.balance).toFixed(2);
        const bonus = user.wallet.bonusCartelaBalance;

        balanceText = isAmharic
          ? `\n💰 *ያለዎት ቀሪ ሂሳብ:* \`${balance} ETB\`\n🎁 *ቦነስ ካርቴላ:* \`${bonus}\`\n`
          : `\n💰 *Current Balance:* \`${balance} ETB\`\n🎁 *Bonus Cartelas:* \`${bonus}\`\n`;
      }
    } catch {
      // Ignore DB query errors and show default text
    }
  }

  const walletUrl = miniappUrl ? `${miniappUrl}/wallet` : undefined;
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

  const walletInfoEn = `
💼 *Friends Bingo Wallet*
${balanceText}
• Top-up instantly via **Telebirr**, **CBE Birr**, **Awash Bank**, or **Bank of Abyssinia**.
• Fast withdrawal processing to your bank or mobile wallet.
• View real-time transactions and game earnings.

Open your wallet below to manage funds:
`;

  const walletInfoAm = `
💼 *የፍሬንድስ ቢንጎ ዋሌት*
${balanceText}
• በ**ቴሌብር**፣ በ**ንግድ ባንክ**፣ በ**አዋሽ ባንክ** ወይም በ**አቢሲኒያ ባንክ** በፍጥነት ገንዘብ ያስገቡ።
• ያሸነፉትን ገንዘብ ወዲያውኑ ወደ ባንክ ሂሳብዎ ወይም ሞባይል ዋሌትዎ ማውጣት ይችላሉ።
• የግብይት ታሪክዎን እና የጨዋታ አሸናፊነትዎን በቅጽበት ይመልከቱ።

ሂሳብዎን ለማስተዳደር ከታች ያለውን ይጫኑ:
`;

  await ctx.reply(isAmharic ? walletInfoAm : walletInfoEn, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}
