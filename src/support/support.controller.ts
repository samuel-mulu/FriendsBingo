import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../common/types/jwt-payload.type';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateSupportMessageDto } from './dto/create-support-message.dto';
import { SupportService } from './support.service';

@ApiTags('support')
@ApiBearerAuth()
@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('messages')
  @ApiOperation({ summary: 'Submit feedback, complaint, or advice to admin' })
  createMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() createSupportMessageDto: CreateSupportMessageDto,
  ) {
    return this.supportService.createMessage(user.id, createSupportMessageDto);
  }

  @Get('messages/me/unread-count')
  @ApiOperation({ summary: 'Count unseen admin replies for badge' })
  getMyUnreadReplyCount(@CurrentUser() user: AuthenticatedUser) {
    return this.supportService.getMyUnreadReplyCount(user.id);
  }

  @Post('messages/me/mark-seen')
  @ApiOperation({ summary: 'Mark admin replies as seen (clear badge)' })
  markMyRepliesSeen(@CurrentUser() user: AuthenticatedUser) {
    return this.supportService.markMyRepliesSeen(user.id);
  }

  @Get('messages/me')
  @ApiOperation({ summary: 'List my submitted support messages' })
  getMyMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Query() paginationQuery: PaginationQueryDto,
  ) {
    return this.supportService.findMyMessages(user.id, paginationQuery);
  }
}
