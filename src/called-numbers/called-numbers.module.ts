import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CalledNumbersService } from './called-numbers.service';

@Module({
  imports: [PrismaModule, RealtimeModule],
  providers: [CalledNumbersService],
  exports: [CalledNumbersService],
})
export class CalledNumbersModule {}
