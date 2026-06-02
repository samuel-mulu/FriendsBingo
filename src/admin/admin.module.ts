import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DepositsModule } from '../deposits/deposits.module';
import { GamesModule } from '../games/games.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [AuthModule, DepositsModule, WithdrawalsModule, GamesModule],
  controllers: [AdminController],
})
export class AdminModule {}
