import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  CHAIN_GAME_DEFAULT_INTER_ROUND_DELAY_SECONDS,
  CHAIN_GAME_MAX_PAUSE_EXTENSION_SECONDS,
} from '../chain-round.util';

export class ExtendChainRoundPauseDto {
  @ApiPropertyOptional({
    example: CHAIN_GAME_DEFAULT_INTER_ROUND_DELAY_SECONDS,
    default: CHAIN_GAME_DEFAULT_INTER_ROUND_DELAY_SECONDS,
    description: 'Extra seconds to add to the current inter-round pause',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CHAIN_GAME_MAX_PAUSE_EXTENSION_SECONDS)
  seconds: number = CHAIN_GAME_DEFAULT_INTER_ROUND_DELAY_SECONDS;
}
