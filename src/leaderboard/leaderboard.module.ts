import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LeaderboardCacheService } from './leaderboard-cache.service';
import { LeaderboardService } from './leaderboard.service';

@Module({
  imports: [PrismaModule],
  providers: [LeaderboardCacheService, LeaderboardService],
  exports: [LeaderboardCacheService, LeaderboardService],
})
export class LeaderboardModule {}
