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
import { BingoClaimsService } from '../bingo-claims/bingo-claims.service';
import { RejectBingoClaimDto } from '../bingo-claims/dto/reject-bingo-claim.dto';
import { CallNumberDto } from '../called-numbers/dto/call-number.dto';
import type { AuthenticatedUser } from '../common/types/jwt-payload.type';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { DepositsService } from '../deposits/deposits.service';
import { RejectDepositDto } from '../deposits/dto/reject-deposit.dto';
import { CreateGameDto } from '../games/dto/create-game.dto';
import { StartSessionDto } from '../games/dto/start-session.dto';
import { UpdateSlotEntryFeeDto } from '../games/dto/update-slot-entry-fee.dto';
import { UpdateGameStatusDto } from '../games/dto/update-game-status.dto';
import { GamesService } from '../games/games.service';
import { GameRulesService } from '../game-rules/game-rules.service';
import { UsersService } from '../users/users.service';
import { WithdrawalsService } from '../withdrawals/withdrawals.service';
import { MarkPaidWithdrawalDto } from '../withdrawals/dto/mark-paid-withdrawal.dto';
import { RejectWithdrawalDto } from '../withdrawals/dto/reject-withdrawal.dto';
import { AdminReportsService } from './admin-reports.service';
import { DateRangeQueryDto } from './dto/date-range-query.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly bingoClaimsService: BingoClaimsService,
    private readonly depositsService: DepositsService,
    private readonly gamesService: GamesService,
    private readonly gameRulesService: GameRulesService,
    private readonly withdrawalsService: WithdrawalsService,
    private readonly adminReportsService: AdminReportsService,
    private readonly usersService: UsersService,
  ) {}

  @Get('reports/overview')
  @ApiOperation({ summary: 'Get admin dashboard overview metrics' })
  getOverviewReport() {
    return this.adminReportsService.getOverview();
  }

  @Get('reports/financial')
  @ApiOperation({ summary: 'Get financial report data' })
  getFinancialReport(@Query() dateRangeQuery: DateRangeQueryDto) {
    return this.adminReportsService.getFinancialReport(dateRangeQuery);
  }

  @Get('reports/games')
  @ApiOperation({ summary: 'Get game performance report data' })
  getGamesReport(@Query() dateRangeQuery: DateRangeQueryDto) {
    return this.adminReportsService.getGamesReport(dateRangeQuery);
  }

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

  @Get('game-rules')
  @ApiOperation({
    summary: 'List active game rules available for normal game creation',
  })
  getGameRules() {
    return this.gameRulesService.listActiveGameRules();
  }

  @Get('slots')
  @ApiOperation({ summary: 'List all game slots in queue' })
  getSlots(@Query() paginationQuery: PaginationQueryDto) {
    return this.gamesService.getAdminSlots(paginationQuery);
  }

  @Post('slots')
  @ApiOperation({ summary: 'Create a game slot' })
  createSlot(
    @Body() createGameDto: CreateGameDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.createGameSlot(createGameDto, user.id);
  }

  @Patch('slots/:id/entry-fee')
  @ApiOperation({ summary: 'Update entry fee for an upcoming NEXT slot' })
  updateSlotEntryFee(
    @Param('id', new ParseUUIDPipe()) slotId: string,
    @Body() updateSlotEntryFeeDto: UpdateSlotEntryFeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.updateSlotEntryFee(
      slotId,
      updateSlotEntryFeeDto,
      user.id,
    );
  }

  @Patch('slots/:id/status')
  @ApiOperation({ summary: 'Update a slot status' })
  updateSlotStatus(
    @Param('id', new ParseUUIDPipe()) slotId: string,
    @Body() updateGameStatusDto: UpdateGameStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.updateSlotStatus(
      slotId,
      updateGameStatusDto,
      user.id,
    );
  }

  @Post('slots/reorder')
  @ApiOperation({ summary: 'Reorder the game queue (Drag-and-Drop)' })
  reorderSlots(
    @Body('slotIds') slotIds: string[],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.updateQueueOrder(slotIds, user.id);
  }

  @Post('slots/:id/start')
  @ApiOperation({ summary: 'Start a session from a slot' })
  startSession(
    @Param('id', new ParseUUIDPipe()) slotId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() startSessionDto: StartSessionDto,
  ) {
    return this.gamesService.startGame(slotId, user.id, startSessionDto);
  }

  @Patch('sessions/:id/cancel')
  @ApiOperation({ summary: 'Force-cancel an orphaned or blocking session' })
  cancelSession(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.cancelOrphanedSession(sessionId, user.id);
  }

  @Post('sessions/:id/call-number')
  @ApiOperation({ summary: 'Call a number for a live session' })
  callNumber(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @Body() callNumberDto: CallNumberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.callNumber(sessionId, callNumberDto, user.id);
  }

  @Post('sessions/:id/auto-call/start')
  @ApiOperation({ summary: 'Start backend auto-call for a live session' })
  startAutoCall(@Param('id', new ParseUUIDPipe()) sessionId: string) {
    return this.gamesService.startAutoCall(sessionId);
  }

  @Post('sessions/:id/auto-call/stop')
  @ApiOperation({ summary: 'Stop backend auto-call for a live session' })
  stopAutoCall(@Param('id', new ParseUUIDPipe()) sessionId: string) {
    return this.gamesService.stopAutoCall(sessionId);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get game session history' })
  getHistory(@Query() paginationQuery: PaginationQueryDto) {
    return this.gamesService.getSessionsHistory(paginationQuery);
  }

  @Get('bingo-claims')
  @ApiOperation({ summary: 'List bingo claims for manual admin review' })
  getBingoClaims(@Query() paginationQuery: PaginationQueryDto) {
    return this.bingoClaimsService.getAdminBingoClaims(paginationQuery);
  }

  @Patch('bingo-claims/:id/approve')
  @ApiOperation({ summary: 'Approve a pending bingo claim' })
  approveBingoClaim(
    @Param('id', new ParseUUIDPipe()) claimId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bingoClaimsService.approveClaim(claimId, user.id);
  }

  @Patch('bingo-claims/:id/reject')
  @ApiOperation({ summary: 'Reject a pending bingo claim' })
  rejectBingoClaim(
    @Param('id', new ParseUUIDPipe()) claimId: string,
    @Body() rejectBingoClaimDto: RejectBingoClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bingoClaimsService.rejectClaim(
      claimId,
      rejectBingoClaimDto,
      user.id,
    );
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'List all withdrawals' })
  getAllWithdrawals(@Query() paginationQuery: PaginationQueryDto) {
    return this.withdrawalsService.getAllWithdrawals(paginationQuery);
  }

  @Get('users')
  @ApiOperation({ summary: 'List users for admin management' })
  getUsers(@Query() paginationQuery: PaginationQueryDto) {
    return this.usersService.getAdminUsers(paginationQuery);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get a single user for admin management' })
  getUser(@Param('id', new ParseUUIDPipe()) userId: string) {
    return this.usersService.getAdminUserById(userId);
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
