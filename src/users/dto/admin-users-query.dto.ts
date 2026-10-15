import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

function optionalQueryBoolean({ value }: { value: unknown }): boolean | undefined {
  if (value === undefined || value === null || value === '' || value === 'all') {
    return undefined;
  }
  if (value === true || value === 'true' || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === '0') {
    return false;
  }
  return value as boolean;
}

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

  @ApiPropertyOptional({ enum: UserStatus, example: UserStatus.BLOCKED })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

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

  @ApiPropertyOptional({
    description:
      'Filter by Auto Mark grant. true = granted, false = revoked/not granted.',
    example: true,
  })
  @IsOptional()
  @Transform(optionalQueryBoolean)
  @IsBoolean()
  autoMarkGranted?: boolean;

  @ApiPropertyOptional({
    description:
      'Filter by Auto Bingo grant. true = granted, false = revoked/not granted.',
    example: false,
  })
  @IsOptional()
  @Transform(optionalQueryBoolean)
  @IsBoolean()
  autoBingoGranted?: boolean;
}
