import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GameTimingConfigModule } from '../game-timing-config/game-timing-config.module';
import { BingoClaimsModule } from '../bingo-claims/bingo-claims.module';
import { DepositsModule } from '../deposits/deposits.module';
import { GamesModule } from '../games/games.module';
import { GameRulesModule } from '../game-rules/game-rules.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SupportModule } from '../support/support.module';
import { UsersModule } from '../users/users.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { AdminBroadcastsService } from './admin-broadcasts.service';
import { AdminExpensesService } from './admin-expenses.service';
import { AdminReportsService } from './admin-reports.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    AuthModule,
    GameTimingConfigModule,
    BingoClaimsModule,
    DepositsModule,
    WithdrawalsModule,
    GamesModule,
    GameRulesModule,
    UsersModule,
    PrismaModule,
    RealtimeModule,
    SupportModule,
  ],
  controllers: [AdminController],
  providers: [
    AdminBroadcastsService,
    AdminExpensesService,
    AdminReportsService,
  ],
  exports: [AdminBroadcastsService],
})
export class AdminModule {}
