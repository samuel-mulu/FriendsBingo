import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export enum AdminUsersSortBy {
  BALANCE = 'balance',
  CREATED_AT = 'createdAt',
}

export enum AdminUsersSortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class AdminUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserRole, example: UserRole.PLAYER })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    description: 'Search by full name or phone number',
    example: 'Abebe',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: AdminUsersSortBy,
    default: AdminUsersSortBy.BALANCE,
  })
  @IsOptional()
  @IsEnum(AdminUsersSortBy)
  sortBy?: AdminUsersSortBy = AdminUsersSortBy.BALANCE;

  @ApiPropertyOptional({
    enum: AdminUsersSortOrder,
    default: AdminUsersSortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(AdminUsersSortOrder)
  sortOrder?: AdminUsersSortOrder = AdminUsersSortOrder.DESC;
}
