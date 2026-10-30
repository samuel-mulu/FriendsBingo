import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CARTELA_CATALOG_DEFAULT_LIMIT,
  CARTELA_CATALOG_MAX_LIMIT,
} from '../cartela-catalog.limits';

export class GetCartelaCatalogQueryDto {
  @ApiPropertyOptional({
    example: CARTELA_CATALOG_DEFAULT_LIMIT,
    minimum: 1,
    maximum: 1000,
    default: CARTELA_CATALOG_DEFAULT_LIMIT,
    description: `Effective cap is ${CARTELA_CATALOG_MAX_LIMIT} rows (larger values are clamped).`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Opaque cursor from a previous paged response',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Filter cartelas whose number starts with this prefix',
    example: '12',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  search?: string;

  @ApiPropertyOptional({
    description:
      'Return a random page from the full catalog (optionally filtered by search)',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  shuffle?: boolean;
}
