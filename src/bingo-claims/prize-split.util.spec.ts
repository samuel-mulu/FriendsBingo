import { Prisma } from '@prisma/client';
import { splitPrizeAmount } from './prize-split.util';

describe('splitPrizeAmount', () => {
  it('splits evenly when divisible', () => {
    const shares = splitPrizeAmount(new Prisma.Decimal('80.00'), 2);
    expect(shares.map((share) => share.toFixed(2))).toEqual(['40.00', '40.00']);
  });

  it('distributes remainder cents without exceeding total', () => {
    const prizeAmount = new Prisma.Decimal('10.00');
    const shares = splitPrizeAmount(prizeAmount, 3);
    const total = shares.reduce(
      (sum, share) => sum.plus(share),
      new Prisma.Decimal(0),
    );

    expect(shares.map((share) => share.toFixed(2))).toEqual([
      '3.34',
      '3.33',
      '3.33',
    ]);
    expect(total.toFixed(2)).toBe('10.00');
  });
});
