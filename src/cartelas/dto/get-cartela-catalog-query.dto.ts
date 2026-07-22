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

export class GetCartelaCatalogQueryDto {
  @ApiPropertyOptional({ example: 1000, minimum: 1, maximum: 1000, default: 1000 })
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
