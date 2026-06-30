import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AdminBroadcastsService } from '../admin/admin-broadcasts.service';
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
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly adminBroadcastsService: AdminBroadcastsService,
  ) {}

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

  @Get('broadcasts')
  @ApiOperation({ summary: 'List admin broadcasts visible to the current player' })
  getBroadcasts(@CurrentUser() user: AuthenticatedUser) {
    return this.adminBroadcastsService.findForUser(user.id);
  }

  @Delete('broadcasts/:id')
  @ApiOperation({ summary: 'Dismiss an admin broadcast for the current player' })
  dismissBroadcast(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) broadcastId: string,
  ) {
    return this.adminBroadcastsService.dismissForUser(user.id, broadcastId);
  }
}
