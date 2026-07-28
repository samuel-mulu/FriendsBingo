-- Leaderboard queries filter winning cartelas by updatedAt and userId.
CREATE INDEX "GameCartela_winner_leaderboard_idx"
ON "GameCartela" ("updatedAt", "userId")
WHERE "isWinner" = true AND status = 'WINNER';
