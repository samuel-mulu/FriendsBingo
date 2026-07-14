import { GameCategory, GameStatus, Prisma } from '@prisma/client';

export const DEFAULT_BONUS_MAX_CARTELAS_PER_PLAYER = 5;

export function isBonusCategory(category?: GameCategory | null): boolean {
  return category === GameCategory.BONUS;
}

export function isBigGotdCategory(category?: GameCategory | null): boolean {
  return category === GameCategory.BIG_GOTD;
}

export function isBonusLikeCategory(category?: GameCategory | null): boolean {
  return isBonusCategory(category) || isBigGotdCategory(category);
}

export function isBigGameCategory(category?: GameCategory | null): boolean {
  return category === GameCategory.BIG_GAME;
}

export function isFreeEntryCategory(category?: GameCategory | null): boolean {
  return isBonusCategory(category);
}

export function isNormalCategory(category?: GameCategory | null): boolean {
  return category === GameCategory.NORMAL;
}

export function canUseBonusCartelaBalance(
  category?: GameCategory | null,
): boolean {
  return isNormalCategory(category);
}

export function isFixedPrizeCategory(category?: GameCategory | null): boolean {
  return isBonusLikeCategory(category) || isBigGameCategory(category);
}

export function isStandardQueueCategory(
  category?: GameCategory | null,
): boolean {
  return !isBigGameCategory(category);
}

export type CartelaPool = 'standard' | 'bigGame';

export function cartelaPoolForCategory(
  category?: GameCategory | null,
): CartelaPool {
  return isBigGameCategory(category) ? 'bigGame' : 'standard';
}

export function sharesCartelaPool(
  left?: GameCategory | null,
  right?: GameCategory | null,
): boolean {
  return cartelaPoolForCategory(left) === cartelaPoolForCategory(right);
}

export function liveCartelaPoolCategoryFilter(
  pool: CartelaPool,
): GameCategory | { in: GameCategory[] } {
  return pool === 'bigGame'
    ? GameCategory.BIG_GAME
    : { in: [GameCategory.NORMAL, GameCategory.BONUS, GameCategory.BIG_GOTD] };
}

export function getBonusCartelaLimit(limit?: number | null): number {
  return limit ?? DEFAULT_BONUS_MAX_CARTELAS_PER_PLAYER;
}

export function compareSortOrder(
  leftSortOrder?: number | null,
  rightSortOrder?: number | null,
): number {
  return (
    (leftSortOrder ?? Number.MAX_SAFE_INTEGER) -
    (rightSortOrder ?? Number.MAX_SAFE_INTEGER)
  );
}

export function isDueBigGameReady(
  category?: GameCategory | null,
  status?: GameStatus | null,
  scheduledStartAt?: Date | null,
  now: Date = new Date(),
): boolean {
  return (
    isBigGameCategory(category) &&
    status === GameStatus.READY &&
    scheduledStartAt != null &&
    scheduledStartAt.getTime() <= now.getTime()
  );
}

export function getRuntimeQueuePriority(
  category?: GameCategory | null,
  status?: GameStatus | null,
  scheduledStartAt?: Date | null,
  now: Date = new Date(),
): number {
  if (isDueBigGameReady(category, status, scheduledStartAt, now)) {
    return 0;
  }

  if (isBigGameCategory(category)) {
    return 3;
  }

  // NORMAL, BONUS, and BIG_GOTD share the same priority; order by sortOrder.
  return 2;
}

export function buildSessionMoneyConfig(slot: {
  entryFee: Prisma.Decimal;
  prizePerCartela: Prisma.Decimal;
  category?: GameCategory | null;
  fixedPrizeAmount?: Prisma.Decimal | null;
}) {
  if (isFreeEntryCategory(slot.category)) {
    return {
      entryFee: new Prisma.Decimal(0),
      prizePerCartela: new Prisma.Decimal(0),
      companyFeePerCartela: new Prisma.Decimal(0),
      prizeAmount: new Prisma.Decimal(slot.fixedPrizeAmount?.toString() ?? '0'),
      companyRevenue: new Prisma.Decimal(0),
    };
  }

  if (isBigGotdCategory(slot.category) || isBigGameCategory(slot.category)) {
    return {
      entryFee: new Prisma.Decimal(slot.entryFee.toString()),
      prizePerCartela: new Prisma.Decimal(0),
      companyFeePerCartela: new Prisma.Decimal(slot.entryFee.toString()),
      prizeAmount: new Prisma.Decimal(slot.fixedPrizeAmount?.toString() ?? '0'),
      companyRevenue: new Prisma.Decimal(0),
    };
  }

  return {
    entryFee: new Prisma.Decimal(slot.entryFee.toString()),
    prizePerCartela: new Prisma.Decimal(slot.prizePerCartela.toString()),
    companyFeePerCartela: new Prisma.Decimal(slot.entryFee.toString()).minus(
      slot.prizePerCartela,
    ),
    prizeAmount: new Prisma.Decimal(0),
    companyRevenue: new Prisma.Decimal(0),
  };
}
