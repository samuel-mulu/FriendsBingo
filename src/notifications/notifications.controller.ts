import { Body, Controller, Delete, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../common/types/jwt-payload.type';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UnregisterDeviceDto } from './dto/unregister-device.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('register-device')
  @ApiOperation({ summary: 'Register or refresh an authenticated device token' })
  @ApiBody({ type: RegisterDeviceDto })
  @ApiOkResponse({
    description: 'Device token registered successfully',
  })
  registerDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() registerDeviceDto: RegisterDeviceDto,
  ) {
    return this.notificationsService.registerDevice(user.id, registerDeviceDto);
  }

  @Delete('register-device')
  @ApiOperation({
    summary: 'Disable an authenticated device token for the current user',
  })
  @ApiBody({ type: UnregisterDeviceDto })
  @ApiOkResponse({
    description: 'Device token disabled successfully',
  })
  unregisterDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() unregisterDeviceDto: UnregisterDeviceDto,
  ) {
    return this.notificationsService.unregisterDevice(
      user.id,
      unregisterDeviceDto.token,
    );
  }
}
