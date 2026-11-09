import { Module } from '@nestjs/common';
import { AppVersionConfigModule } from '../app-version-config/app-version-config.module';
import { AppVersionController } from './app-version.controller';
import { AppVersionService } from './app-version.service';

@Module({
  imports: [AppVersionConfigModule],
  controllers: [AppVersionController],
  providers: [AppVersionService],
})
export class AppVersionModule {}
