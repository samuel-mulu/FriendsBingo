import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BingoClaimsModule } from '../bingo-claims/bingo-claims.module';
import { DepositsModule } from '../deposits/deposits.module';
import { GamesModule } from '../games/games.module';
import { GameRulesModule } from '../game-rules/game-rules.module';
import { UsersModule } from '../users/users.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { AdminExpensesService } from './admin-expenses.service';
import { AdminReportsService } from './admin-reports.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    AuthModule,
    BingoClaimsModule,
    DepositsModule,
    WithdrawalsModule,
    GamesModule,
    GameRulesModule,
    UsersModule,
  ],
  controllers: [AdminController],
  providers: [AdminExpensesService, AdminReportsService],
})
export class AdminModule {}
