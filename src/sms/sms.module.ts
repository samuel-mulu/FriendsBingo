import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GeezSmsProvider } from './providers/geezsms.provider';
import { SmsController } from './sms.controller';
import { SmsService } from './sms.service';

@Module({
  imports: [PrismaModule],
  controllers: [SmsController],
  providers: [SmsService, GeezSmsProvider],
  exports: [SmsService],
})
export class SmsModule {}
