import { Prisma } from '@prisma/client';

export function splitPrizeAmount(
  prizeAmount: Prisma.Decimal,
  winnerCount: number,
): Prisma.Decimal[] {
  if (winnerCount <= 0) {
    throw new Error('winnerCount must be greater than zero');
  }

  const totalCents = prizeAmount.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
  const baseShareCents = totalCents
    .div(winnerCount)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
  const remainderCents = totalCents.minus(baseShareCents.mul(winnerCount));

  const shares: Prisma.Decimal[] = [];
  for (let index = 0; index < winnerCount; index += 1) {
    const extraCent = index < remainderCents.toNumber() ? 1 : 0;
    shares.push(
      baseShareCents
        .plus(extraCent)
        .div(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN),
    );
  }

  return shares;
}
