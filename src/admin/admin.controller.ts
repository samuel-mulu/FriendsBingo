import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipAppThrottlers } from '../common/decorators/skip-app-throttlers.decorator';
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
import { AdminWithdrawalsQueryDto } from '../withdrawals/dto/admin-withdrawals-query.dto';
import { AdminDevicesQueryDto } from '../users/dto/admin-devices-query.dto';
import { AdminUserWalletTransactionsQueryDto } from '../users/dto/admin-user-wallet-transactions-query.dto';
import { AdminUsersQueryDto } from '../users/dto/admin-users-query.dto';
import { DepositsService } from '../deposits/deposits.service';
import { AdminDepositsQueryDto } from '../deposits/dto/admin-deposits-query.dto';
import { RejectDepositDto } from '../deposits/dto/reject-deposit.dto';
import { ApproveDepositDto } from '../deposits/dto/approve-deposit.dto';
import { CreateGameDto } from '../games/dto/create-game.dto';
import { StartSessionDto } from '../games/dto/start-session.dto';
import { UpdateSlotEntryFeeDto } from '../games/dto/update-slot-entry-fee.dto';
import { UpdateBigGameScheduleDto } from '../games/dto/update-big-game-schedule.dto';
import { UpdateSlotOperationModeDto } from '../games/dto/update-slot-operation-mode.dto';
import { UpdateGameStatusDto } from '../games/dto/update-game-status.dto';
import { GamesService } from '../games/games.service';
import { GameRulesService } from '../game-rules/game-rules.service';
import { UsersService } from '../users/users.service';
import { WithdrawalsService } from '../withdrawals/withdrawals.service';
import { ApproveWithdrawalDto } from '../withdrawals/dto/approve-withdrawal.dto';
import { MarkPaidWithdrawalDto } from '../withdrawals/dto/mark-paid-withdrawal.dto';
import { RejectWithdrawalDto } from '../withdrawals/dto/reject-withdrawal.dto';
import { AuthService } from '../auth/auth.service';
import { AdminBroadcastsService } from './admin-broadcasts.service';
import { AdminExpensesService } from './admin-expenses.service';
import { AdminReportsService } from './admin-reports.service';
import { ChangeAdminPasswordDto } from './dto/change-admin-password.dto';
import { CreateAdminBroadcastDto } from './dto/create-admin-broadcast.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { DateRangeQueryDto } from './dto/date-range-query.dto';
import { FinancialReportQueryDto } from './dto/financial-report-query.dto';
import { DepositApprovalConfigService } from '../deposit-approval-config/deposit-approval-config.service';
import { UpdateDepositApprovalConfigDto } from '../deposit-approval-config/dto/update-deposit-approval-config.dto';
import { AppDisplayConfigService } from '../app-display-config/app-display-config.service';
import { UpdateAppDisplayConfigDto } from '../app-display-config/dto/update-app-display-config.dto';
import { GameTimingConfigService } from '../game-timing-config/game-timing-config.service';
import { UpdateGameTimingConfigDto } from '../game-timing-config/dto/update-game-timing-config.dto';
import { ReplySupportMessageDto } from '../support/dto/reply-support-message.dto';
import { AdminCreateSupportMessageDto } from '../support/dto/admin-create-support-message.dto';
import { SupportMessagesQueryDto } from '../support/dto/support-messages-query.dto';
import { SupportService } from '../support/support.service';
import { SmsService } from '../sms/sms.service';
import { LeaderboardQueryDto } from '../leaderboard/dto/leaderboard-query.dto';
import { LeaderboardService } from '../leaderboard/leaderboard.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@SkipAppThrottlers()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly authService: AuthService,
    private readonly bingoClaimsService: BingoClaimsService,
    private readonly depositsService: DepositsService,
    private readonly gamesService: GamesService,
    private readonly gameRulesService: GameRulesService,
    private readonly withdrawalsService: WithdrawalsService,
    private readonly adminReportsService: AdminReportsService,
    private readonly adminExpensesService: AdminExpensesService,
    private readonly adminBroadcastsService: AdminBroadcastsService,
    private readonly usersService: UsersService,
    private readonly gameTimingConfigService: GameTimingConfigService,
    private readonly appDisplayConfigService: AppDisplayConfigService,
    private readonly depositApprovalConfigService: DepositApprovalConfigService,
    private readonly supportService: SupportService,
    private readonly smsService: SmsService,
    private readonly leaderboardService: LeaderboardService,
  ) {}

  @Post('change-password')
  @ApiOperation({
    summary: 'Change the logged-in admin password',
    description:
      'Requires the current password. Revokes all refresh tokens after a successful change.',
  })
  changePassword(
    @Body() changeAdminPasswordDto: ChangeAdminPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.changeAdminPassword(
      user.id,
      changeAdminPasswordDto,
    );
  }

  @Get('leaderboard/cartela-wins')
  @ApiOperation({
    summary: 'Get House Champions leaderboard for admin',
    description:
      'Top players by winning cartelas. Supports custom date ranges for historical weeks.',
  })
  getCartelaWinsLeaderboard(@Query() query: LeaderboardQueryDto) {
    return this.leaderboardService.getCartelaWinsLeaderboard(query, {
      includePrivateFields: true,
      allowCustomPeriod: true,
    });
  }

  @Get('sms/balance')
  @ApiOperation({ summary: 'Get GeezSMS account balance' })
  getSmsBalance() {
    return this.smsService.getBalance();
  }

  @Get('support/messages/open-count')
  @ApiOperation({ summary: 'Count OPEN support messages for admin badge' })
  getOpenSupportMessageCount() {
    return this.supportService.getOpenMessageCount();
  }

  @Post('support/messages')
  @ApiOperation({ summary: 'Send feedback/message to a player' })
  createSupportMessage(
    @Body() adminCreateSupportMessageDto: AdminCreateSupportMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supportService.createAsAdmin(
      user.id,
      adminCreateSupportMessageDto,
    );
  }

  @Get('support/messages')
  @ApiOperation({ summary: 'List player support messages' })
  getSupportMessages(@Query() query: SupportMessagesQueryDto) {
    return this.supportService.findAdminMessages(query);
  }

  @Get('support/messages/:id')
  @ApiOperation({ summary: 'Get a player support message' })
  getSupportMessage(@Param('id', new ParseUUIDPipe()) messageId: string) {
    return this.supportService.findAdminMessageById(messageId);
  }

  @Patch('support/messages/:id')
  @ApiOperation({ summary: 'Reply to or close a player support message' })
  replyToSupportMessage(
    @Param('id', new ParseUUIDPipe()) messageId: string,
    @Body() replySupportMessageDto: ReplySupportMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supportService.replyAsAdmin(
      messageId,
      user.id,
      replySupportMessageDto,
    );
  }

  @Post('broadcasts')
  @ApiOperation({ summary: 'Post a broadcast message to all players' })
  createBroadcast(
    @Body() createAdminBroadcastDto: CreateAdminBroadcastDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminBroadcastsService.create(user.id, createAdminBroadcastDto);
  }

  @Get('broadcasts')
  @ApiOperation({ summary: 'List all admin broadcast messages' })
  getBroadcasts() {
    return this.adminBroadcastsService.findAll();
  }

  @Delete('broadcasts/:id')
  @ApiOperation({ summary: 'Delete an admin broadcast message' })
  deleteBroadcast(@Param('id', new ParseUUIDPipe()) broadcastId: string) {
    return this.adminBroadcastsService.delete(broadcastId);
  }

  @Get('time-config')
  @SkipAppThrottlers()
  @ApiOperation({ summary: 'Get global game timing defaults' })
  getTimeConfig() {
    return this.gameTimingConfigService.getAdminConfig();
  }

  @Patch('time-config')
  @ApiOperation({
    summary: 'Update global game timing defaults',
    description:
      'Applies to new games, new winner windows, and new reservations. Active session snapshots are unchanged.',
  })
  updateTimeConfig(
    @Body() updateGameTimingConfigDto: UpdateGameTimingConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gameTimingConfigService.updateConfig(
      updateGameTimingConfigDto,
      user.id,
    );
  }

  @Get('deposit-config')
  @ApiOperation({ summary: 'Get deposit approval configuration' })
  getDepositApprovalConfig() {
    return this.depositApprovalConfigService.getAdminConfig();
  }

  @Patch('deposit-config')
  @ApiOperation({ summary: 'Update deposit approval configuration' })
  updateDepositApprovalConfig(
    @Body() updateDepositApprovalConfigDto: UpdateDepositApprovalConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.depositApprovalConfigService.updateConfig(
      updateDepositApprovalConfigDto,
      user.id,
    );
  }

  @Get('display-config')
  @ApiOperation({ summary: 'Get app display configuration' })
  getDisplayConfig() {
    return this.appDisplayConfigService.getAdminConfig();
  }

  @Patch('display-config')
  @ApiOperation({
    summary: 'Update app display configuration',
    description:
      'Controls whether winner phone numbers are included in player-facing winner results.',
  })
  updateDisplayConfig(
    @Body() updateAppDisplayConfigDto: UpdateAppDisplayConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appDisplayConfigService.updateConfig(
      updateAppDisplayConfigDto,
      user.id,
    );
  }

  @Get('reports/overview')
  @ApiOperation({ summary: 'Get admin dashboard overview metrics' })
  getOverviewReport() {
    return this.adminReportsService.getOverview();
  }

  @Get('reports/financial')
  @ApiOperation({ summary: 'Get financial report data' })
  getFinancialReport(@Query() dateRangeQuery: FinancialReportQueryDto) {
    return this.adminReportsService.getFinancialReport(dateRangeQuery);
  }

  @Post('expenses')
  @ApiOperation({ summary: 'Record an operational expense' })
  createExpense(
    @Body() createExpenseDto: CreateExpenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminExpensesService.createExpense(createExpenseDto, user.id);
  }

  @Get('expenses')
  @ApiOperation({ summary: 'List expenses in a date range' })
  getExpenses(@Query() dateRangeQuery: DateRangeQueryDto) {
    return this.adminExpensesService.findExpensesInRange(dateRangeQuery);
  }

  @Get('reports/games')
  @ApiOperation({ summary: 'Get game performance report data' })
  getGamesReport(@Query() dateRangeQuery: DateRangeQueryDto) {
    return this.adminReportsService.getGamesReport(dateRangeQuery);
  }

  @Get('deposits/pending-count')
  @ApiOperation({ summary: 'Count pending deposits for admin badge' })
  getPendingDepositCount() {
    return this.depositsService.getPendingDepositCount();
  }

  @Get('deposits')
  @ApiOperation({ summary: 'List all deposits' })
  getAllDeposits(@Query() query: AdminDepositsQueryDto) {
    return this.depositsService.getAllDeposits(query);
  }

  @Patch('deposits/:id/approve')
  @ApiOperation({ summary: 'Approve a deposit manually' })
  approveDeposit(
    @Param('id', new ParseUUIDPipe()) depositId: string,
    @Body() approveDepositDto: ApproveDepositDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.depositsService.approveDeposit(
      depositId,
      approveDepositDto,
      user.id,
    );
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

  @Patch('slots/:id/operation-mode')
  @ApiOperation({
    summary: 'Switch operation mode for the current queued or live game',
  })
  updateSlotOperationMode(
    @Param('id', new ParseUUIDPipe()) slotId: string,
    @Body() updateSlotOperationModeDto: UpdateSlotOperationModeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.switchSlotOperationMode(
      slotId,
      updateSlotOperationModeDto,
      user.id,
    );
  }

  @Patch('slots/:id/entry-fee')
  @ApiOperation({
    summary:
      'Update entry fee for an upcoming NEXT slot or a READY big game with no registrations',
  })
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

  @Patch('slots/:id/big-game-schedule')
  @ApiOperation({
    summary:
      'Update registration opens and play start times for a READY big game',
  })
  updateBigGameSchedule(
    @Param('id', new ParseUUIDPipe()) slotId: string,
    @Body() updateBigGameScheduleDto: UpdateBigGameScheduleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.updateBigGameSchedule(
      slotId,
      updateBigGameScheduleDto,
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

  @Post('slots/clear-queue')
  @ApiOperation({
    summary:
      'Clear queued NEXT slots safely while preserving live/checking games and active registrations',
  })
  clearQueue(@CurrentUser() user: AuthenticatedUser) {
    return this.gamesService.clearQueue(user.id);
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

  @Get('sessions/:id/registered-players')
  @ApiOperation({
    summary:
      'List players and their non-cancelled registered cartelas for a session',
  })
  getSessionRegisteredPlayers(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
  ) {
    return this.gamesService.getSessionRegisteredPlayers(sessionId);
  }

  @Patch('sessions/:id/cancel')
  @ApiOperation({
    summary: 'Cancel a READY/PLAYING/CHECKING session (refunds all entry fees)',
  })
  cancelSession(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.cancelOrphanedSession(sessionId, user.id);
  }

  @Patch('sessions/:id/finalize-winner-window')
  @ApiOperation({
    summary:
      'Close an open winner window immediately and pay out winners (alternative to cancelling)',
  })
  finalizeWinnerWindowEarly(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bingoClaimsService.finalizeWinnerWindowEarly(
      sessionId,
      user.id,
    );
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
  @SkipAppThrottlers()
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

  @Get('withdrawals/pending-count')
  @ApiOperation({ summary: 'Count pending withdrawals for admin badge' })
  getPendingWithdrawalCount() {
    return this.withdrawalsService.getPendingWithdrawalCount();
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'List all withdrawals' })
  getAllWithdrawals(@Query() query: AdminWithdrawalsQueryDto) {
    return this.withdrawalsService.getAllWithdrawals(query);
  }

  @Get('devices')
  @ApiOperation({
    summary: 'List app install device IDs linked to player accounts',
    description:
      'Aggregates device IDs from refresh sessions and welcome-bonus grants so admins can spot multi-account devices.',
  })
  getDevices(@Query() query: AdminDevicesQueryDto) {
    return this.usersService.getAdminDevices(query);
  }

  @Get('users')
  @ApiOperation({ summary: 'List users for admin management' })
  getUsers(@Query() paginationQuery: AdminUsersQueryDto) {
    return this.usersService.getAdminUsers(paginationQuery);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get a single user for admin management' })
  getUser(@Param('id', new ParseUUIDPipe()) userId: string) {
    return this.usersService.getAdminUserById(userId);
  }

  @Get('users/:id/financial-history')
  @ApiOperation({
    summary: 'Get player financial history for withdrawal security review',
  })
  getUserFinancialHistory(@Param('id', new ParseUUIDPipe()) userId: string) {
    return this.usersService.getAdminUserFinancialHistory(userId);
  }

  @Get('users/:id/game-history')
  @ApiOperation({ summary: 'List finished games a player attended' })
  async getUserGameHistory(
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Query() paginationQuery: PaginationQueryDto,
  ) {
    await this.usersService.assertUserExists(userId);
    return this.gamesService.getMyAttendedSessionsHistory(
      userId,
      paginationQuery,
    );
  }

  @Get('users/:id/wallet-transactions')
  @ApiOperation({ summary: 'Paginated wallet transactions for a player' })
  getUserWalletTransactions(
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Query() query: AdminUserWalletTransactionsQueryDto,
  ) {
    return this.usersService.getAdminUserWalletTransactions(userId, query);
  }

  @Patch('withdrawals/:id/approve')
  @ApiOperation({
    summary: 'Approve and pay a withdrawal',
    description:
      'Confirms payout with a transaction URL, marks the withdrawal paid, and releases locked funds.',
  })
  approveWithdrawal(
    @Param('id', new ParseUUIDPipe()) withdrawalId: string,
    @Body() approveWithdrawalDto: ApproveWithdrawalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.withdrawalsService.approveWithdrawal(
      withdrawalId,
      approveWithdrawalDto,
      user.id,
    );
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
  @ApiOperation({
    summary: 'Mark a withdrawal as paid (legacy)',
    deprecated: true,
    description:
      'Deprecated. Use approve for pending withdrawals. Only for legacy APPROVED rows.',
  })
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
