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
    When a valid Bearer token is sent, registeredCartelasSummary includes ME/OTHER ownership.`,
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

  @Get('sessions/:id/called-numbers')
  @SkipAppThrottlers()
  @ApiOperation({ summary: 'Get called numbers for a session' })
  getCalledNumbers(@Param('id', new ParseUUIDPipe()) sessionId: string) {
    return this.gamesService.getCalledNumbers(sessionId);
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

  @Get('history')
  @ApiOperation({ summary: 'Get finished sessions history' })
  getHistory(@Query() paginationQuery: PaginationQueryDto) {
    return this.gamesService.getSessionsHistory(paginationQuery, {
      forPlayer: true,
    });
  }
}
