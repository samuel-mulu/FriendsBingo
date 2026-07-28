import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { GameCartelaStatus, Prisma, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LeaderboardQueryDto } from './dto/leaderboard-query.dto';
import { LeaderboardCacheService } from './leaderboard-cache.service';
import {
  LeaderboardPeriod,
  LEADERBOARD_TIMEZONE,
  resolveLeaderboardPeriodRange,
} from './leaderboard-period.util';
import {
  LeaderboardEntryRecord,
  serializeLeaderboardEntry,
} from './leaderboard.mapper';

const PLAYER_LEADERBOARD_PERIODS = new Set<LeaderboardPeriod>([
  LeaderboardPeriod.TODAY,
  LeaderboardPeriod.WEEK,
  LeaderboardPeriod.LAST_WEEK,
  LeaderboardPeriod.LAST_30_DAYS,
  LeaderboardPeriod.ALL_TIME,
]);

@Injectable()
export class LeaderboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboardCacheService: LeaderboardCacheService,
  ) {}

  invalidateCache(): void {
    this.leaderboardCacheService.invalidate();
  }

  async getCartelaWinsLeaderboard(
    query: LeaderboardQueryDto,
    options?: {
      currentUserId?: string;
      includePrivateFields?: boolean;
      allowCustomPeriod?: boolean;
    },
  ) {
    const period = query.period ?? LeaderboardPeriod.WEEK;
    const limit = query.limit ?? 15;

    if (!options?.allowCustomPeriod && period === LeaderboardPeriod.CUSTOM) {
      throw new BadRequestException('Custom period is not available.');
    }

    if (
      !options?.allowCustomPeriod &&
      !PLAYER_LEADERBOARD_PERIODS.has(period)
    ) {
      throw new BadRequestException('Unsupported leaderboard period.');
    }

    let range: ReturnType<typeof resolveLeaderboardPeriodRange>;
    try {
      range = resolveLeaderboardPeriodRange(period, {
        from: query.from,
        to: query.to,
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid leaderboard period.',
      );
    }

    const cacheKey = [
      'cartela-wins',
      period,
      range.periodStart?.toISOString() ?? 'all',
      range.periodEnd?.toISOString() ?? 'all',
      String(limit),
      options?.includePrivateFields ? 'admin' : 'public',
      options?.currentUserId ?? 'guest',
    ].join(':');

    const cached = this.leaderboardCacheService.read<unknown>(cacheKey);
    if (cached) {
      return cached;
    }

    const payload = await this.buildLeaderboard(range, limit, options);
    this.leaderboardCacheService.write(cacheKey, payload);
    return payload;
  }

  private async buildLeaderboard(
    range: ReturnType<typeof resolveLeaderboardPeriodRange>,
    limit: number,
    options?: {
      currentUserId?: string;
      includePrivateFields?: boolean;
    },
  ) {
    const entries = await this.fetchTopEntries(
      range.periodStart,
      range.periodEnd,
      limit,
    );

    const users = entries.length
      ? await this.prisma.user.findMany({
          where: {
            id: { in: entries.map((entry) => entry.userId) },
          },
          select: {
            id: true,
            fullName: true,
            phoneNumber: true,
          },
        })
      : [];

    const usersById = new Map(users.map((user) => [user.id, user]));

    const serializedEntries = entries
      .map((entry, index) => {
        const user = usersById.get(entry.userId);
        if (!user) {
          return null;
        }

        return serializeLeaderboardEntry(entry, user, index + 1, {
          includePrivateFields: options?.includePrivateFields ?? false,
        });
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    let me: {
      rank: number;
      cartelaWins: number;
      gamesWon: number;
    } | null = null;

    if (options?.currentUserId) {
      me = await this.fetchCurrentUserStanding(
        options.currentUserId,
        range.periodStart,
        range.periodEnd,
      );
    }

    return {
      period: range.period,
      timezone: LEADERBOARD_TIMEZONE,
      periodStart: range.periodStart?.toISOString() ?? null,
      periodEnd: range.periodEnd?.toISOString() ?? null,
      labelStart: range.labelStart,
      labelEnd: range.labelEnd,
      metric: 'cartela_wins',
      limit,
      updatedAt: new Date().toISOString(),
      entries: serializedEntries,
      me,
    };
  }

  private async fetchTopEntries(
    periodStart: Date | null,
    periodEnd: Date | null,
    limit: number,
  ): Promise<LeaderboardEntryRecord[]> {
    const dateFilter =
      periodStart && periodEnd
        ? Prisma.sql`AND gc."updatedAt" >= ${periodStart} AND gc."updatedAt" < ${periodEnd}`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{
        userId: string;
        cartelaWins: number;
        gamesWon: number;
        firstWinAt: Date;
      }>
    >(Prisma.sql`
      SELECT
        gc."userId" AS "userId",
        COUNT(*)::int AS "cartelaWins",
        COUNT(DISTINCT gc."gameSessionId")::int AS "gamesWon",
        MIN(gc."updatedAt") AS "firstWinAt"
      FROM "GameCartela" gc
      INNER JOIN "User" u ON u.id = gc."userId"
      WHERE gc."isWinner" = true
        AND gc.status = ${GameCartelaStatus.WINNER}::"GameCartelaStatus"
        AND u.role = ${UserRole.PLAYER}::"UserRole"
        AND u.status = ${UserStatus.ACTIVE}::"UserStatus"
        ${dateFilter}
      GROUP BY gc."userId"
      ORDER BY "cartelaWins" DESC, "firstWinAt" ASC
      LIMIT ${limit}
    `);

    return rows;
  }

  private async fetchCurrentUserStanding(
    userId: string,
    periodStart: Date | null,
    periodEnd: Date | null,
  ): Promise<{ rank: number; cartelaWins: number; gamesWon: number } | null> {
    const dateFilter =
      periodStart && periodEnd
        ? Prisma.sql`AND gc."updatedAt" >= ${periodStart} AND gc."updatedAt" < ${periodEnd}`
        : Prisma.empty;

    const [standing] = await this.prisma.$queryRaw<
      Array<{
        rank: number;
        cartelaWins: number;
        gamesWon: number;
      }>
    >(Prisma.sql`
      WITH standings AS (
        SELECT
          gc."userId" AS "userId",
          COUNT(*)::int AS "cartelaWins",
          COUNT(DISTINCT gc."gameSessionId")::int AS "gamesWon",
          RANK() OVER (
            ORDER BY COUNT(*) DESC, MIN(gc."updatedAt") ASC
          )::int AS rank
        FROM "GameCartela" gc
        INNER JOIN "User" u ON u.id = gc."userId"
        WHERE gc."isWinner" = true
          AND gc.status = ${GameCartelaStatus.WINNER}::"GameCartelaStatus"
          AND u.role = ${UserRole.PLAYER}::"UserRole"
          AND u.status = ${UserStatus.ACTIVE}::"UserStatus"
          ${dateFilter}
        GROUP BY gc."userId"
      )
      SELECT rank, "cartelaWins", "gamesWon"
      FROM standings
      WHERE "userId" = ${userId}
    `);

    if (!standing || standing.cartelaWins === 0) {
      return null;
    }

    return standing;
  }
}
