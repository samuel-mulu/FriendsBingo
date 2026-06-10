import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipAppThrottlers } from '../common/decorators/skip-app-throttlers.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../common/types/jwt-payload.type';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { WalletService } from './wallet.service';

@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('me')
  @SkipAppThrottlers()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current user wallet' })
  getMyWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getMyWallet(user.id);
  }

  @Get('transactions/me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current user wallet transaction history' })
  getMyTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() paginationQuery: PaginationQueryDto,
  ) {
    return this.walletService.getMyTransactions(user.id, paginationQuery);
  }
}
