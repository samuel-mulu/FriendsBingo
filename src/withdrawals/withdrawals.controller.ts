import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../common/types/jwt-payload.type';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { WithdrawalsService } from './withdrawals.service';

@ApiTags('withdrawals')
@ApiBearerAuth()
@Controller('withdrawals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PLAYER)
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a withdrawal request' })
  createWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() createWithdrawalDto: CreateWithdrawalDto,
  ) {
    return this.withdrawalsService.createWithdrawal(
      user.id,
      createWithdrawalDto,
    );
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user withdrawal history' })
  getMyWithdrawals(
    @CurrentUser() user: AuthenticatedUser,
    @Query() paginationQuery: PaginationQueryDto,
  ) {
    return this.withdrawalsService.getMyWithdrawals(user.id, paginationQuery);
  }
}
