import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { DateRangeQueryDto } from './date-range-query.dto';

export const FINANCIAL_SETTLEMENT_ACCOUNT_KEYS = [
  'all',
  'telebirr_1',
  'telebirr_2',
  'cbe',
] as const;

export type FinancialSettlementAccountKey =
  (typeof FINANCIAL_SETTLEMENT_ACCOUNT_KEYS)[number];

export class FinancialReportQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({
    enum: FINANCIAL_SETTLEMENT_ACCOUNT_KEYS,
    default: 'all',
    description:
      'Filter deposits by receiving settlement account (Telebirr 1/2 or CBE)',
  })
  @IsOptional()
  @IsIn(FINANCIAL_SETTLEMENT_ACCOUNT_KEYS)
  settlementAccount?: FinancialSettlementAccountKey;
}
