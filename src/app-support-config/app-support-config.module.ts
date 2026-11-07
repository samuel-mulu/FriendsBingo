import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AppSupportConfigService } from './app-support-config.service';

@Module({
  imports: [PrismaModule, CommonModule],
  providers: [AppSupportConfigService],
  exports: [AppSupportConfigService],
})
export class AppSupportConfigModule {}
