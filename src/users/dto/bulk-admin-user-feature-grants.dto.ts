import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { UpdateAdminUserFeatureGrantsDto } from './update-admin-user-feature-grants.dto';

/** Explicit ID mode hard cap per request (filter mode is unbounded by this). */
export const MAX_BULK_FEATURE_GRANT_USER_IDS = 500;

/** Internal DB chunk size for lock + update transactions. */
export const BULK_FEATURE_GRANT_CHUNK_SIZE = 100;

/** Bounded socket fan-out batch size. */
export const BULK_FEATURE_GRANT_SOCKET_BATCH_SIZE = 50;

export class BulkAdminUserFeatureGrantsFilterDto {
  @ApiPropertyOptional({ enum: UserRole, example: UserRole.PLAYER })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: UserStatus, example: UserStatus.ACTIVE })
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
}

export class BulkAdminUserFeatureGrantsDto {
  @ApiPropertyOptional({
    type: [String],
    description: `Explicit user IDs (max ${MAX_BULK_FEATURE_GRANT_USER_IDS}). Mutually exclusive with filter.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_FEATURE_GRANT_USER_IDS)
  @IsUUID('4', { each: true })
  userIds?: string[];

  @ApiPropertyOptional({
    type: BulkAdminUserFeatureGrantsFilterDto,
    description:
      'Server-side filter matching GET /admin/users semantics. Mutually exclusive with userIds.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BulkAdminUserFeatureGrantsFilterDto)
  filter?: BulkAdminUserFeatureGrantsFilterDto;

  @ApiProperty({ type: UpdateAdminUserFeatureGrantsDto })
  @ValidateNested()
  @Type(() => UpdateAdminUserFeatureGrantsDto)
  patch!: UpdateAdminUserFeatureGrantsDto;

  @ApiPropertyOptional({
    description:
      'Client-generated UUID for idempotent apply retries. Required for apply; optional for dryRun.',
  })
  @IsOptional()
  @IsUUID('4')
  operationId?: string;

  @ApiPropertyOptional({
    description:
      'When true, only resolve targets and return matched count without mutating.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
