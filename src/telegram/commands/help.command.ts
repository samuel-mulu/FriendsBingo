import { Context } from 'grammy';
import { getMainMenuKeyboard } from '../keyboards/main-menu.keyboard';

export async function handleHelpCommand(
  ctx: Context,
  miniappUrl?: string,
): Promise<void> {
  const isAmharic = ctx.from?.language_code?.toLowerCase().startsWith('am');

  const helpTextEn = `
ℹ️ *Friends Bingo — Rules & Guide*

1. *Registration:*
   Choose and register one or more cartelas before a game round begins (status: READY).
2. *Live Draw:*
   Numbers (1-75) under columns B-I-N-G-O are drawn sequentially in real-time.
3. *Marking:*
   Tap numbers on your cartela as they appear, or enable Auto-Mark in your Profile settings.
4. *Winning BINGO:*
   Complete any winning pattern (horizontal, vertical, diagonal, or 4 corners) and hit the **BINGO!** button before anyone else!

Need support? Contact our 24/7 team in the app support tab.
`;

  const helpTextAm = `
ℹ️ *የፍሬንድስ ቢንጎ — የጨዋታው ሕጎች እና መመሪያ*

1. *መመዝገብ:*
   የጨዋታው ዙር ከመጀመሩ በፊት አንድ ወይም ከዚያ በላይ ካርቴላዎችን ይምረጡና ይመዝገቡ (ሁኔታ: ዝግጁ)።
2. *የቀጥታ ዕጣ:*
   ከ1 እስከ 75 ያሉት ቁጥሮች በ B-I-N-G-O ረድፎች ስር በቀጥታ ይወጣሉ።
3. *ቁጥሮችን ማጥቆር (Marking):*
   ቁጥሮች ሲወጡ በካርቴላዎ ላይ ይንኩ ወይም በፕሮፋይልዎ ውስጥ "Auto-Mark" ን ያብሩ።
4. *ቢንጎ ማሸነፍ:*
   አሸናፊ ቅጦችን (አግድም፣ ቁመት፣ ሰያፍ ወይም 4 ማዕዘናት) ሲያጠናቅቁ ወዲያውኑ የ **BINGO!** ቁልፍን ይጫኑ!

ድጋፍ ይፈልጋሉ? በመተግበሪያው ውስጥ ያለውን የድጋፍ ክፍል ያግኙ።
`;

  await ctx.reply(isAmharic ? helpTextAm : helpTextEn, {
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard(miniappUrl, undefined, isAmharic ? 'am' : 'en'),
  });
}
