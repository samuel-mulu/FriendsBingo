import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BigGameTicketModule } from '../games/big-game-ticket.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [PrismaModule, AuthModule, BigGameTicketModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
