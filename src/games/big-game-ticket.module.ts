import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BigGameTicketService } from './big-game-ticket.service';

@Module({
  imports: [PrismaModule],
  providers: [BigGameTicketService],
  exports: [BigGameTicketService],
})
export class BigGameTicketModule {}
