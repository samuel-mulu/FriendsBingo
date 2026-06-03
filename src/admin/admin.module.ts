import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DepositsModule } from '../deposits/deposits.module';
import { GamesModule } from '../games/games.module';
import { UsersModule } from '../users/users.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { AdminReportsService } from './admin-reports.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    AuthModule,
    DepositsModule,
    WithdrawalsModule,
    GamesModule,
    UsersModule,
  ],
  controllers: [AdminController],
  providers: [AdminReportsService],
})
export class AdminModule {}
