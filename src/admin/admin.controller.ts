import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
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
import { DepositsService } from '../deposits/deposits.service';
import { RejectDepositDto } from '../deposits/dto/reject-deposit.dto';
import { CreateGameDto } from '../games/dto/create-game.dto';
import { UpdateGameStatusDto } from '../games/dto/update-game-status.dto';
import { GamesService } from '../games/games.service';
import { CallNumberDto } from '../called-numbers/dto/call-number.dto';
import { WithdrawalsService } from '../withdrawals/withdrawals.service';
import { MarkPaidWithdrawalDto } from '../withdrawals/dto/mark-paid-withdrawal.dto';
import { RejectWithdrawalDto } from '../withdrawals/dto/reject-withdrawal.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly depositsService: DepositsService,
    private readonly gamesService: GamesService,
    private readonly withdrawalsService: WithdrawalsService,
  ) {}

  @Get('deposits')
  @ApiOperation({ summary: 'List all deposits' })
  getAllDeposits(@Query() paginationQuery: PaginationQueryDto) {
    return this.depositsService.getAllDeposits(paginationQuery);
  }

  @Patch('deposits/:id/approve')
  @ApiOperation({ summary: 'Approve a deposit manually' })
  approveDeposit(
    @Param('id', new ParseUUIDPipe()) depositId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.depositsService.approveDeposit(depositId, user.id);
  }

  @Patch('deposits/:id/reject')
  @ApiOperation({ summary: 'Reject a deposit manually' })
  rejectDeposit(
    @Param('id', new ParseUUIDPipe()) depositId: string,
    @Body() rejectDepositDto: RejectDepositDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.depositsService.rejectDeposit(
      depositId,
      rejectDepositDto,
      user.id,
    );
  }

  @Post('games')
  @ApiOperation({ summary: 'Create a game' })
  createGame(
    @Body() createGameDto: CreateGameDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.createGame(createGameDto, user.id);
  }

  @Get('games')
  @ApiOperation({ summary: 'List all games' })
  getAllGames(@Query() paginationQuery: PaginationQueryDto) {
    return this.gamesService.getAdminGames(paginationQuery);
  }

  @Patch('games/:id/status')
  @ApiOperation({ summary: 'Update a game status' })
  updateGameStatus(
    @Param('id', new ParseUUIDPipe()) gameId: string,
    @Body() updateGameStatusDto: UpdateGameStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.updateGameStatus(gameId, updateGameStatusDto, user.id);
  }

  @Post('games/:id/start')
  @ApiOperation({ summary: 'Start a checking game' })
  startGame(
    @Param('id', new ParseUUIDPipe()) gameId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.startGame(gameId, user.id);
  }

  @Post('games/:id/call-number')
  @ApiOperation({ summary: 'Call a game number' })
  callNumber(
    @Param('id', new ParseUUIDPipe()) gameId: string,
    @Body() callNumberDto: CallNumberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.callNumber(gameId, callNumberDto, user.id);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'List all withdrawals' })
  getAllWithdrawals(@Query() paginationQuery: PaginationQueryDto) {
    return this.withdrawalsService.getAllWithdrawals(paginationQuery);
  }

  @Patch('withdrawals/:id/approve')
  @ApiOperation({ summary: 'Approve a withdrawal' })
  approveWithdrawal(
    @Param('id', new ParseUUIDPipe()) withdrawalId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.withdrawalsService.approveWithdrawal(withdrawalId, user.id);
  }

  @Patch('withdrawals/:id/reject')
  @ApiOperation({ summary: 'Reject a withdrawal' })
  rejectWithdrawal(
    @Param('id', new ParseUUIDPipe()) withdrawalId: string,
    @Body() rejectWithdrawalDto: RejectWithdrawalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.withdrawalsService.rejectWithdrawal(
      withdrawalId,
      rejectWithdrawalDto,
      user.id,
    );
  }

  @Patch('withdrawals/:id/mark-paid')
  @ApiOperation({ summary: 'Mark a withdrawal as paid' })
  markWithdrawalPaid(
    @Param('id', new ParseUUIDPipe()) withdrawalId: string,
    @Body() markPaidWithdrawalDto: MarkPaidWithdrawalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.withdrawalsService.markWithdrawalPaid(
      withdrawalId,
      markPaidWithdrawalDto,
      user.id,
    );
  }
}
