import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipAppThrottlers } from '../common/decorators/skip-app-throttlers.decorator';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../common/types/jwt-payload.type';
import { CreateBingoClaimDto } from '../bingo-claims/dto/create-bingo-claim.dto';
import { GamesService } from './games.service';
import { RegisterCartelaDto } from './dto/register-cartela.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('games')
@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  @SkipAppThrottlers()
  @ApiOperation({ summary: 'List publicly available game slots in queue' })
  getAvailableSlots() {
    return this.gamesService.getAvailableSlots();
  }

  @Get('time-config')
  @SkipAppThrottlers()
  @ApiOperation({
    summary: 'Get player-facing timing defaults',
    description:
      'Public subset for client UX: cartela hold, finished display, stagger, and refetch debounce.',
  })
  getTimeConfig() {
    return this.gamesService.getPlayerTimeConfig();
  }

  @Get('current/live')
  @SkipAppThrottlers()
  @ApiOperation({
    summary: 'Get current live session or next slot (deprecated)',
    description:
      'Deprecated. Use GET /games/operations/current instead. This endpoint delegates to canonical operations selection and returns the player-facing current game only.',
  })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getCurrentLiveSession(@CurrentUser() user: AuthenticatedUser) {
    return this.gamesService.getCurrentLiveSession(user.id);
  }

  /**
   * CANONICAL SOURCE OF TRUTH for current game operations.
   * This endpoint returns the exact same game selection for both Admin and Flutter.
   * Backend decides which game is live/checking/registration/queue.
   * Frontend MUST NOT apply additional filtering or sorting.
   */
  @Get('operations/current')
  @SkipAppThrottlers()
  @ApiOperation({
    summary: 'Get current game operations state (canonical source of truth)',
    description: `Returns the current operational state with:
    - liveGame: Currently PLAYING game (null if none)
    - checkingGame: Game with bingo claim under review (null if none)
    - registrationOpenGame: Game accepting registrations (null if none)
    - queue: Upcoming games in order

    Backend decides priority: PLAYING > CHECKING > READY > NEXT
    Both Admin and Flutter use this to ensure they display the SAME game.
    Public endpoint — guests may browse without authentication.
    Cartela availability is served separately by GET /games/sessions/:id/registration-state.`,
  })
  @UseGuards(OptionalJwtAuthGuard)
  getCurrentOperations(
    @Req() request: { user?: AuthenticatedUser | null },
  ) {
    const user = request.user ?? undefined;
    if (user) {
      return this.gamesService.getCurrentOperations(user.id, user.role);
    }

    return this.gamesService.getCurrentOperations();
  }

  @Get('slots/:id')
  @SkipAppThrottlers()
  @ApiOperation({ summary: 'Get slot detail' })
  getSlotDetail(@Param('id', new ParseUUIDPipe()) slotId: string) {
    return this.gamesService.getSlotDetail(slotId);
  }

  @Get('sessions/:id')
  @SkipAppThrottlers()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get session detail' })
  getSessionDetail(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.getSessionDetail(sessionId, user.id);
  }

  @Get('sessions/:id/winner-results')
  @SkipAppThrottlers()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Get winning cartela results for a finished session',
    description:
      'Returns winner cartela grids and backend-validated completed patterns.',
  })
  getSessionWinnerResults(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @Req() request: { user?: AuthenticatedUser | null },
  ) {
    return this.gamesService.getSessionWinnerResults(
      sessionId,
      request.user?.id,
    );
  }

  /**
   * Public-safe winner result for Flutter post-game display.
   * No sensitive user data (phone, wallet, etc.).
   */
  @Get('sessions/:id/winner-result')
  @SkipAppThrottlers()
  @ApiOperation({
    summary: 'Get public winner result for a session',
    description:
      'Returns public-safe winner cartela info: number, pattern cells, prize. No private user data.',
  })
  getPublicWinnerResult(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
  ) {
    return this.gamesService.getPublicWinnerResult(sessionId);
  }

  @Get('sessions/:id/called-numbers')
  @SkipAppThrottlers()
  @ApiOperation({ summary: 'Get called numbers for a session' })
  getCalledNumbers(@Param('id', new ParseUUIDPipe()) sessionId: string) {
    return this.gamesService.getCalledNumbers(sessionId);
  }

  @Get('sessions/:id/registration-state')
  @SkipAppThrottlers()
  @ApiOperation({
    summary: 'Get cartela registration availability for a session',
    description:
      'Returns registered and reserved cartela summaries for the registration grid. Use only while registration UI is visible.',
  })
  @UseGuards(OptionalJwtAuthGuard)
  getRegistrationState(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @Req() request: { user?: AuthenticatedUser | null },
  ) {
    return this.gamesService.getRegistrationState(
      sessionId,
      request.user?.id,
    );
  }

  @Post('sessions/:id/register-cartela')
  @SkipAppThrottlers()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLAYER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register a cartela for a session' })
  registerCartela(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() registerCartelaDto: RegisterCartelaDto,
  ) {
    return this.gamesService.registerCartela(
      sessionId,
      user.id,
      registerCartelaDto,
    );
  }

  @Post('slots/:slotId/register-cartela')
  @SkipAppThrottlers()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLAYER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register a cartela for a slot (NEXT or PLAYING)' })
  registerCartelaForSlot(
    @Param('slotId', new ParseUUIDPipe()) slotId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() registerCartelaDto: RegisterCartelaDto,
  ) {
    return this.gamesService.registerCartelaForSlot(
      slotId,
      user.id,
      registerCartelaDto,
    );
  }

  @Post('sessions/:id/cartelas/:cartelaId/reserve')
  @SkipAppThrottlers()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLAYER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reserve a cartela for 10 seconds before confirming' })
  reserveCartela(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @Param('cartelaId', new ParseUUIDPipe()) cartelaId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.reserveCartela(sessionId, user.id, cartelaId);
  }

  @Post('slots/:slotId/cartelas/:cartelaId/reserve')
  @SkipAppThrottlers()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLAYER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reserve a cartela for a slot (NEXT or PLAYING)',
  })
  reserveCartelaForSlot(
    @Param('slotId', new ParseUUIDPipe()) slotId: string,
    @Param('cartelaId', new ParseUUIDPipe()) cartelaId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.reserveCartelaForSlot(slotId, user.id, cartelaId);
  }

  @Post('reservations/:id/confirm')
  @SkipAppThrottlers()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLAYER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm a cartela reservation and register' })
  confirmReservation(
    @Param('id', new ParseUUIDPipe()) reservationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.confirmReservation(reservationId, user.id);
  }

  @Post('reservations/:id/cancel')
  @SkipAppThrottlers()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLAYER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel an active cartela reservation' })
  cancelReservation(
    @Param('id', new ParseUUIDPipe()) reservationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.cancelReservation(reservationId, user.id);
  }

  @Post('sessions/:id/bingo')
  @SkipAppThrottlers()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLAYER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit a bingo claim for a session' })
  claimBingo(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() createBingoClaimDto: CreateBingoClaimDto,
  ) {
    return this.gamesService.claimBingo(
      sessionId,
      user.id,
      createBingoClaimDto,
    );
  }

  @Get('sessions/:id/my-cartelas')
  @SkipAppThrottlers()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLAYER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current user cartelas registered in a session',
  })
  getMyCartelas(
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.getMyCartelas(sessionId, user.id);
  }

  @Get('my-history')
  @SkipAppThrottlers()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLAYER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get finished sessions the current player joined',
    description:
      'Returns paginated finished sessions where the player registered at least one cartela, including that player cartela boards in each item.',
  })
  getMyHistory(
    @Query() paginationQuery: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.getMyAttendedSessionsHistory(
      user.id,
      paginationQuery,
    );
  }

  @Get('history')
  @ApiOperation({ summary: 'Get finished sessions history' })
  getHistory(@Query() paginationQuery: PaginationQueryDto) {
    return this.gamesService.getSessionsHistory(paginationQuery, {
      forPlayer: true,
    });
  }
}
