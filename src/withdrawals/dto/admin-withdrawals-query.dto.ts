import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentProvider, WithdrawStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class AdminWithdrawalsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Search by player name, phone, receiver account, receiver phone, or payout reference',
    example: '2519',
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
    enum: WithdrawStatus,
    description: 'Filter by withdrawal status.',
  })
  @IsOptional()
  @IsEnum(WithdrawStatus)
  status?: WithdrawStatus;

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
