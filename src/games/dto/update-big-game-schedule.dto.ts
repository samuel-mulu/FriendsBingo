import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

export class UpdateBigGameScheduleDto {
  @ApiPropertyOptional({ example: '2026-06-26T08:00:00.000Z' })
  @IsOptional()
  @IsISO8601(
    {},
    { message: 'registrationOpensAt must be a valid ISO datetime' },
  )
  registrationOpensAt?: string;

  @ApiPropertyOptional({ example: '2026-06-26T20:00:00.000Z' })
  @IsOptional()
  @IsISO8601({}, { message: 'playStartAt must be a valid ISO datetime' })
  playStartAt?: string;
}
