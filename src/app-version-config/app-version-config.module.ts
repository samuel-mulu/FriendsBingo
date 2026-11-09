import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AppVersionConfigService } from './app-version-config.service';

@Module({
  imports: [PrismaModule, CommonModule],
  providers: [AppVersionConfigService],
  exports: [AppVersionConfigService],
})
export class AppVersionConfigModule {}
