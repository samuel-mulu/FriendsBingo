import { Context } from 'grammy';
import { PrismaService } from '../../prisma/prisma.service';
import { getMainMenuKeyboard } from '../keyboards/main-menu.keyboard';
import { escapeTelegramHtml } from '../telegram-formatting.util';

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
        ? '🎲 <b>በአሁኑ ሰዓት ክፍት ጨዋታዎች የሉም</b>\n\nእባክዎ ከጥቂት ደቂቃዎች በኋላ እንደገና ይሞክሩ ወይም አፑን ይክፈቱ!'
        : '🎲 <b>No active games at this moment</b>\n\nPlease check back in a few moments or open the Mini App!';

      await ctx.reply(noGamesMsg, {
        parse_mode: 'HTML',
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
        ? '🎲 <b>ክፍት የፍሬንድስ ቢንጎ ጨዋታዎች:</b>\n'
        : '🎲 <b>Active Friends Bingo Games:</b>\n',
    );

    for (const slot of activeSlots) {
      const fee = Number(slot.entryFee).toFixed(0);
      const name = escapeTelegramHtml(slot.name);
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
        `${statusIcon} <b>${name}</b> — ${fee} ETB [${statusText}]`,
      );
    }

    lines.push(
      isAmharic
        ? '\nለመጫወት እና ካርቴላ ለመምረጥ ከታች ያለውን ቁልፍ ይጫኑ!'
        : '\nTap below to enter and pick your cartelas!',
    );

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: getMainMenuKeyboard(
        miniappUrl,
        undefined,
        isAmharic ? 'am' : 'en',
      ),
    });
  } catch (error) {
    // Graceful fallback on any query issue
    const fallbackMsg = isAmharic
      ? '🎲 <b>የቀጥታ ጨዋታዎችን ለመቀላቀል ከታች ያለውን ይጫኑ:</b>'
      : '🎲 <b>Join active games directly in the Mini App:</b>';

    await ctx.reply(fallbackMsg, {
      parse_mode: 'HTML',
      reply_markup: getMainMenuKeyboard(
        miniappUrl,
        undefined,
        isAmharic ? 'am' : 'en',
      ),
    });
  }
}
