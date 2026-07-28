import { ApiPropertyOptional } from '@nestjs/swagger';
import { DepositStatus, PaymentProvider } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class AdminDepositsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search by transaction reference, player name, or phone',
    example: 'FT123',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: PaymentProvider,
    description: 'Filter by payment provider. Omit for all providers.',
  })
  @IsOptional()
  @IsEnum(PaymentProvider)
  provider?: PaymentProvider;

  @ApiPropertyOptional({
    enum: DepositStatus,
    description: 'Filter by deposit status.',
  })
  @IsOptional()
  @IsEnum(DepositStatus)
  status?: DepositStatus;

  @ApiPropertyOptional({
    example: '2026-06-01',
    description: 'Inclusive start date (YYYY-MM-DD or ISO datetime)',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-06-30',
    description: 'Inclusive end date (YYYY-MM-DD or ISO datetime)',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
