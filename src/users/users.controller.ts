import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipAppThrottlers } from '../common/decorators/skip-app-throttlers.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../common/types/jwt-payload.type';
import { UpdateFeatureSettingsDto } from './dto/update-feature-settings.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @SkipAppThrottlers()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getMe(user.id);
  }

  @Get('me/feature-settings')
  @SkipAppThrottlers()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get Auto Mark / Auto Bingo feature settings' })
  getFeatureSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getFeatureSettings(user.id);
  }

  @Patch('me/feature-settings')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update Auto Mark / Auto Bingo player preferences',
  })
  updateFeatureSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateFeatureSettingsDto,
  ) {
    return this.usersService.updateFeatureSettings(user.id, dto);
  }

  @Patch('me/notification-preferences')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update current user notification preferences' })
  updateNotificationPreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.usersService.updateNotificationPreferences(user.id, dto);
  }
}
