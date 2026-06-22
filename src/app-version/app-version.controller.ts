import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipAppThrottlers } from '../common/decorators/skip-app-throttlers.decorator';
import { AppVersionService } from './app-version.service';

@ApiTags('app-version')
@Controller('app-version')
export class AppVersionController {
  constructor(private readonly appVersionService: AppVersionService) {}

  @Get('android')
  @SkipAppThrottlers()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get Android APK version requirements' })
  getAndroidVersion() {
    return this.appVersionService.getAndroidVersion();
  }
}
