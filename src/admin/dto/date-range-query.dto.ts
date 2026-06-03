import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class DateRangeQueryDto {
  @ApiPropertyOptional({
    example: '2026-06-01',
    description: 'Inclusive start date or datetime in ISO format',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-06-30',
    description: 'Inclusive end date or datetime in ISO format',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
