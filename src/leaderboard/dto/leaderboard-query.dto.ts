import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { LeaderboardPeriod } from '../leaderboard-period.util';

export class LeaderboardQueryDto {
  @ApiPropertyOptional({
    enum: LeaderboardPeriod,
    default: LeaderboardPeriod.WEEK,
    description:
      'Leaderboard period. Use custom with from/to for admin date-range filters.',
  })
  @IsOptional()
  @IsEnum(LeaderboardPeriod)
  period?: LeaderboardPeriod = LeaderboardPeriod.WEEK;

  @ApiPropertyOptional({
    example: 15,
    minimum: 1,
    maximum: 50,
    default: 15,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 15;

  @ApiPropertyOptional({
    example: '2026-07-01T00:00:00.000Z',
    description: 'Inclusive custom range start (required when period=custom).',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-07-31T23:59:59.999Z',
    description: 'Exclusive custom range end (required when period=custom).',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
