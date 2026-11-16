import { Context } from 'grammy';
import { PrismaService } from '../../prisma/prisma.service';
import { getMainMenuKeyboard } from '../keyboards/main-menu.keyboard';

export async function handleGamesCommand(
  ctx: Context,
  prisma: PrismaService,
  miniappUrl?: string,
): Promise<void> {
  const isAmharic = ctx.from?.language_code?.toLowerCase().startsWith('am');

  try {
    const activeSlots = await prisma.gameSlot.findMany({
      where: {
        status: { in: ['READY', 'NEXT', 'PLAYING', 'CHECKING'] },
      },
      orderBy: [{ sortOrder: 'asc' }, { entryFee: 'asc' }],
      take: 6,
    });

    if (activeSlots.length === 0) {
      const noGamesMsg = isAmharic
        ? '🎲 *በአሁኑ ሰዓት ክፍት ጨዋታዎች የሉም*\n\nእባክዎ ከጥቂት ደቂቃዎች በኋላ እንደገና ይሞክሩ ወይም አፑን ይክፈቱ!'
        : '🎲 *No active games at this moment*\n\nPlease check back in a few moments or open the Mini App!';

      await ctx.reply(noGamesMsg, {
        parse_mode: 'Markdown',
        reply_markup: getMainMenuKeyboard(
          miniappUrl,
          undefined,
          isAmharic ? 'am' : 'en',
        ),
      });
      return;
    }

    const lines: string[] = [];
    lines.push(
      isAmharic
        ? '🎲 *ክፍት የፍሬንድስ ቢንጎ ጨዋታዎች:*\n'
        : '🎲 *Active Friends Bingo Games:*\n',
    );

    for (const slot of activeSlots) {
      const fee = Number(slot.entryFee).toFixed(0);
      const statusIcon =
        slot.status === 'PLAYING'
          ? '🔴'
          : slot.status === 'READY'
            ? '🟢'
            : '🟡';
      const statusText =
        slot.status === 'PLAYING'
          ? isAmharic
            ? 'በመካሄድ ላይ'
            : 'In Progress'
          : slot.status === 'READY'
            ? isAmharic
              ? 'ምዝገባ ክፍት'
              : 'Registering'
            : isAmharic
              ? 'ቀጣይ ዙር'
              : 'Upcoming';

      lines.push(
        `${statusIcon} *${slot.name}* — ${fee} ETB [${statusText}]`,
      );
    }

    lines.push(
      isAmharic
        ? '\nለመጫወት እና ካርቴላ ለመምረጥ ከታች ያለውን ቁልፍ ይጫኑ!'
        : '\nTap below to enter and pick your cartelas!',
    );

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard(
        miniappUrl,
        undefined,
        isAmharic ? 'am' : 'en',
      ),
    });
  } catch (error) {
    // Graceful fallback on any query issue
    const fallbackMsg = isAmharic
      ? '🎲 *የቀጥታ ጨዋታዎችን ለመቀላቀል ከታች ያለውን ይጫኑ:*'
      : '🎲 *Join active games directly in the Mini App:*';

    await ctx.reply(fallbackMsg, {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard(
        miniappUrl,
        undefined,
        isAmharic ? 'am' : 'en',
      ),
    });
  }
}
