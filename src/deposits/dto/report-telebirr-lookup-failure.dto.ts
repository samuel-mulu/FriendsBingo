import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReportTelebirrLookupFailureDto {
  @ApiPropertyOptional({ example: '26032014112345' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  transactionRef?: string;

  @ApiPropertyOptional({ example: 'HTTP 429 rate limit' })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  reason?: string;
}
