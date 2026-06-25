import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../common/types/jwt-payload.type';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CheckDepositReferenceDto } from './dto/check-deposit-reference.dto';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { DepositsService } from './deposits.service';

@ApiTags('deposits')
@ApiBearerAuth()
@Controller('deposits')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PLAYER)
export class DepositsController {
  constructor(private readonly depositsService: DepositsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a deposit request and trigger verification',
  })
  createDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() createDepositDto: CreateDepositDto,
  ) {
    return this.depositsService.createDeposit(user.id, createDepositDto);
  }

  @Post('check-ref')
  @ApiOperation({
    summary: 'Check whether a deposit reference was already submitted',
  })
  checkReference(
    @CurrentUser() user: AuthenticatedUser,
    @Body() checkDepositReferenceDto: CheckDepositReferenceDto,
  ) {
    return this.depositsService.checkDepositReference(
      user.id,
      checkDepositReferenceDto,
    );
  }

  @Get('config')
  @ApiOperation({ summary: 'Get deposit provider configuration for the app' })
  getDepositConfig() {
    return this.depositsService.getDepositConfig();
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user deposit history' })
  getMyDeposits(
    @CurrentUser() user: AuthenticatedUser,
    @Query() paginationQuery: PaginationQueryDto,
  ) {
    return this.depositsService.getMyDeposits(user.id, paginationQuery);
  }
}
