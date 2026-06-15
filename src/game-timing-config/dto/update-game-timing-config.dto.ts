import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { GAME_TIMING_BOUNDS } from '../game-timing-config.defaults';

export class UpdateGameTimingConfigDto {
  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(GAME_TIMING_BOUNDS.registrationDurationSeconds.min)
  @Max(GAME_TIMING_BOUNDS.registrationDurationSeconds.max)
  registrationDurationSeconds?: number;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(GAME_TIMING_BOUNDS.autoCallIntervalSeconds.min)
  @Max(GAME_TIMING_BOUNDS.autoCallIntervalSeconds.max)
  autoCallIntervalSeconds?: number;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(GAME_TIMING_BOUNDS.winnerWindowSeconds.min)
  @Max(GAME_TIMING_BOUNDS.winnerWindowSeconds.max)
  winnerWindowSeconds?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(GAME_TIMING_BOUNDS.cartelaHoldSeconds.min)
  @Max(GAME_TIMING_BOUNDS.cartelaHoldSeconds.max)
  cartelaHoldSeconds?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(GAME_TIMING_BOUNDS.finishedResultDisplaySeconds.min)
  @Max(GAME_TIMING_BOUNDS.finishedResultDisplaySeconds.max)
  finishedResultDisplaySeconds?: number;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(GAME_TIMING_BOUNDS.winningPatternDisplaySeconds.min)
  @Max(GAME_TIMING_BOUNDS.winningPatternDisplaySeconds.max)
  winningPatternDisplaySeconds?: number;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description: 'Optional max wait while preparing; null disables the cap',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(GAME_TIMING_BOUNDS.preparingDisplayMaxSeconds.min)
  @Max(GAME_TIMING_BOUNDS.preparingDisplayMaxSeconds.max)
  preparingDisplayMaxSeconds?: number | null;

  @ApiPropertyOptional({ example: 150 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(GAME_TIMING_BOUNDS.missedNumberAnimationMs.min)
  @Max(GAME_TIMING_BOUNDS.missedNumberAnimationMs.max)
  missedNumberAnimationMs?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(GAME_TIMING_BOUNDS.missedNumberStaggerMaxBalls.min)
  @Max(GAME_TIMING_BOUNDS.missedNumberStaggerMaxBalls.max)
  missedNumberStaggerMaxBalls?: number;

  @ApiPropertyOptional({ example: 2500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(GAME_TIMING_BOUNDS.adminRefreshDebounceMs.min)
  @Max(GAME_TIMING_BOUNDS.adminRefreshDebounceMs.max)
  adminRefreshDebounceMs?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(GAME_TIMING_BOUNDS.adminFallbackPollingSeconds.min)
  @Max(GAME_TIMING_BOUNDS.adminFallbackPollingSeconds.max)
  adminFallbackPollingSeconds?: number;

  @ApiPropertyOptional({ example: 400 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(GAME_TIMING_BOUNDS.flutterRefetchDebounceMs.min)
  @Max(GAME_TIMING_BOUNDS.flutterRefetchDebounceMs.max)
  flutterRefetchDebounceMs?: number;
}
