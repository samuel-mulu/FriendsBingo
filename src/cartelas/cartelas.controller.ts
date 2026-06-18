import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipAppThrottlers } from '../common/decorators/skip-app-throttlers.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../common/types/jwt-payload.type';
import { CartelasService } from './cartelas.service';
import { GetCartelaBoardQueryDto } from './dto/get-cartela-board-query.dto';

@ApiTags('cartelas')
@SkipAppThrottlers()
@Controller('cartelas')
export class CartelasController {
  constructor(private readonly cartelasService: CartelasService) {}

  @Get()
  @ApiOperation({
    summary: 'List cartelas for registration browsing',
    description:
      'Public catalog of cartela ids, numbers, and board values for preview during registration.',
  })
  getCartelaCatalog() {
    return this.cartelasService.getCartelaCatalog();
  }

  @Get(':cartelaId/board')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get full cartela board for an owned or reserved cartela',
    description:
      'Players may preview a board only for an active reservation or a registered cartela in the given session. Admins may preview any cartela.',
  })
  getCartelaBoard(
    @Param('cartelaId', new ParseUUIDPipe()) cartelaId: string,
    @Query() query: GetCartelaBoardQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cartelasService.getCartelaBoard(
      cartelaId,
      user.id,
      user.role,
      query.sessionId,
    );
  }
}
