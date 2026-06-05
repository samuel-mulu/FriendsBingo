import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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

@ApiTags('games')
@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  @ApiOperation({ summary: 'List publicly available games' })
  getAvailableGames() {
    return this.gamesService.getAvailableGames();
  }

  @Get('current/live')
  @ApiOperation({ summary: 'Get current live game' })
  getCurrentLiveGame() {
    return this.gamesService.getCurrentLiveGame();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get game detail' })
  getGameDetail(@Param('id', new ParseUUIDPipe()) gameId: string) {
    return this.gamesService.getGameDetail(gameId);
  }

  @Get(':id/called-numbers')
  @ApiOperation({ summary: 'Get called numbers for a game' })
  getCalledNumbers(@Param('id', new ParseUUIDPipe()) gameId: string) {
    return this.gamesService.getCalledNumbers(gameId);
  }

  @Post(':id/register-cartela')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLAYER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register a cartela for a game' })
  registerCartela(
    @Param('id', new ParseUUIDPipe()) gameId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() registerCartelaDto: RegisterCartelaDto,
  ) {
    return this.gamesService.registerCartela(
      gameId,
      user.id,
      registerCartelaDto,
    );
  }

  @Post(':id/bingo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLAYER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit a bingo claim' })
  claimBingo(
    @Param('id', new ParseUUIDPipe()) gameId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() createBingoClaimDto: CreateBingoClaimDto,
  ) {
    return this.gamesService.claimBingo(gameId, user.id, createBingoClaimDto);
  }

  @Get(':id/my-cartelas')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLAYER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user cartelas registered in a game' })
  getMyCartelas(
    @Param('id', new ParseUUIDPipe()) gameId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.gamesService.getMyCartelas(gameId, user.id);
  }
}
