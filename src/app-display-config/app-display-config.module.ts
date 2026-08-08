import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AppDisplayConfigService } from './app-display-config.service';

@Module({
  imports: [PrismaModule, CommonModule],
  providers: [AppDisplayConfigService],
  exports: [AppDisplayConfigService],
})
export class AppDisplayConfigModule {}
