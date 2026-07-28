export function toPublicDisplayName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return 'Player';
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0];
  }

  const lastInitial = parts[parts.length - 1]?.[0]?.toUpperCase() ?? '';
  return lastInitial ? `${parts[0]} ${lastInitial}.` : parts[0];
}

export interface LeaderboardEntryRecord {
  userId: string;
  cartelaWins: number;
  gamesWon: number;
  firstWinAt: Date;
}

export interface LeaderboardUserRecord {
  id: string;
  fullName: string;
  phoneNumber: string;
}

export function serializeLeaderboardEntry(
  entry: LeaderboardEntryRecord,
  user: LeaderboardUserRecord,
  rank: number,
  options: { includePrivateFields?: boolean },
) {
  return {
    rank,
    userId: entry.userId,
    displayName: toPublicDisplayName(user.fullName),
    cartelaWins: entry.cartelaWins,
    gamesWon: entry.gamesWon,
    ...(options.includePrivateFields
      ? {
          fullName: user.fullName,
          phoneNumber: user.phoneNumber,
        }
      : {}),
  };
}
