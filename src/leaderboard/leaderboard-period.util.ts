export enum LeaderboardPeriod {
  TODAY = 'today',
  WEEK = 'week',
  LAST_WEEK = 'last_week',
  LAST_30_DAYS = 'last_30_days',
  ALL_TIME = 'all_time',
  CUSTOM = 'custom',
}

export const LEADERBOARD_TIMEZONE = 'Africa/Addis_Ababa';

export interface LeaderboardPeriodRange {
  period: LeaderboardPeriod;
  periodStart: Date | null;
  periodEnd: Date | null;
  labelStart: string | null;
  labelEnd: string | null;
}

interface EatDateParts {
  year: number;
  month: number;
  day: number;
}

function getEatDateParts(date: Date): EatDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: LEADERBOARD_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
  };
}

function eatMidnightUtc(parts: EatDateParts): Date {
  const iso = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T00:00:00+03:00`;
  return new Date(iso);
}

function addEatDays(parts: EatDateParts, days: number): EatDateParts {
  const date = eatMidnightUtc(parts);
  date.setUTCDate(date.getUTCDate() + days);
  return getEatDateParts(date);
}

function formatEatLabel(date: Date | null): string | null {
  if (!date) {
    return null;
  }

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LEADERBOARD_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function startOfEatWeek(parts: EatDateParts): EatDateParts {
  const midnight = eatMidnightUtc(parts);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: LEADERBOARD_TIMEZONE,
    weekday: 'short',
  }).format(midnight);
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    weekday,
  );
  const daysFromMonday = (weekdayIndex + 6) % 7;
  return addEatDays(parts, -daysFromMonday);
}

export function resolveLeaderboardPeriodRange(
  period: LeaderboardPeriod,
  options?: { from?: string; to?: string; now?: Date },
): LeaderboardPeriodRange {
  const now = options?.now ?? new Date();
  const today = getEatDateParts(now);

  if (period === LeaderboardPeriod.ALL_TIME) {
    return {
      period,
      periodStart: null,
      periodEnd: null,
      labelStart: null,
      labelEnd: null,
    };
  }

  if (period === LeaderboardPeriod.CUSTOM) {
    if (!options?.from || !options?.to) {
      throw new Error('Custom leaderboard period requires from and to.');
    }

    const periodStart = new Date(options.from);
    const periodEnd = new Date(options.to);

    return {
      period,
      periodStart,
      periodEnd,
      labelStart: formatEatLabel(periodStart),
      labelEnd: formatEatLabel(periodEnd),
    };
  }

  if (period === LeaderboardPeriod.TODAY) {
    const periodStart = eatMidnightUtc(today);
    const periodEnd = eatMidnightUtc(addEatDays(today, 1));
    return {
      period,
      periodStart,
      periodEnd,
      labelStart: formatEatLabel(periodStart),
      labelEnd: formatEatLabel(eatMidnightUtc(today)),
    };
  }

  if (period === LeaderboardPeriod.WEEK) {
    const weekStartParts = startOfEatWeek(today);
    const periodStart = eatMidnightUtc(weekStartParts);
    const periodEnd = eatMidnightUtc(addEatDays(weekStartParts, 7));
    return {
      period,
      periodStart,
      periodEnd,
      labelStart: formatEatLabel(periodStart),
      labelEnd: formatEatLabel(eatMidnightUtc(today)),
    };
  }

  if (period === LeaderboardPeriod.LAST_WEEK) {
    const thisWeekStart = startOfEatWeek(today);
    const lastWeekStart = addEatDays(thisWeekStart, -7);
    const periodStart = eatMidnightUtc(lastWeekStart);
    const periodEnd = eatMidnightUtc(thisWeekStart);
    return {
      period,
      periodStart,
      periodEnd,
      labelStart: formatEatLabel(periodStart),
      labelEnd: formatEatLabel(eatMidnightUtc(addEatDays(thisWeekStart, -1))),
    };
  }

  if (period === LeaderboardPeriod.LAST_30_DAYS) {
    const periodEnd = eatMidnightUtc(addEatDays(today, 1));
    const periodStart = eatMidnightUtc(addEatDays(today, -29));
    return {
      period,
      periodStart,
      periodEnd,
      labelStart: formatEatLabel(periodStart),
      labelEnd: formatEatLabel(eatMidnightUtc(today)),
    };
  }

  throw new Error(`Unsupported leaderboard period: ${period}`);
}
