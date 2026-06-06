import {
  Body,
  Controller,
  Get,
  Param,
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
import { CreateBingoClaimDto } from '../bingo-claims/dto/create-bingo-claim.dto';
import { GamesService } from './games.service';
import { RegisterCartelaDto } from './dto/register-cartela.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('games')
@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  @ApiOperation({ summary: 'List publicly available game slots in queue' })
  getAvailableSlots() {
    return this.gamesService.getAvailableSlots();
  }

  @Get('current/live')
  @ApiOperation({ summary: 'Get current live session or next slot' })
  getCurrentLiveSession() {
    return this.gamesService.getCurrentLiveSession();
  }

  @Get('slots/:id')
  @ApiOperation({ summary: 'Get slot detail' })
  getSlotDetail(@Param('id', new ParseUUIDPipe()) slotId: string) {
    return this.gamesService.getSlotDetail(slotId);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Get session detail' })
  getSessionDetail(@Param('id', new ParseUUIDPipe()) sessionId: string) {
    // Note: Need to implement getSessionDetail in service if not already there
    return this.gamesService.getSessionDetail(sessionId);
  }

  @Get('sessions/:id/called-numbers')
  @ApiOperation({ summary: 'Get called numbers for a session' })
  getCalledNumbers(@Param('id', new ParseUUIDPipe()) sessionId: string) {
    return this.gamesService.getCalledNumbers(sessionId);
  }

  @Post('sessions/:id/register-cartela')
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

  @Post('sessions/:id/bingo')
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
