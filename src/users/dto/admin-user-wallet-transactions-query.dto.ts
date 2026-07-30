import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export enum AdminWalletTransactionCategory {
  ALL = 'ALL',
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  GAME = 'GAME',
  PRIZE = 'PRIZE',
  OTHER = 'OTHER',
}

/** Deposit or withdrawal status when filtering ledger entries. */
export enum AdminWalletTransactionReferenceStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PAID = 'PAID',
}

export class AdminUserWalletTransactionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: AdminWalletTransactionCategory,
    default: AdminWalletTransactionCategory.ALL,
    description: 'Filter by transaction category.',
  })
  @IsOptional()
  @IsEnum(AdminWalletTransactionCategory)
  category?: AdminWalletTransactionCategory =
    AdminWalletTransactionCategory.ALL;

  @ApiPropertyOptional({
    enum: AdminWalletTransactionReferenceStatus,
    description:
      'Filter deposit/withdrawal ledger rows by linked record status.',
  })
  @IsOptional()
  @IsEnum(AdminWalletTransactionReferenceStatus)
  status?: AdminWalletTransactionReferenceStatus;
}
