import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_BULK_CARTELAS_PER_REQUEST } from '../registration-limits';

export class BulkRegisterCartelaItemDto {
  @ApiProperty({ example: '9bbeb535-bf01-4d6e-823c-e6d5556430d4' })
  @IsUUID()
  cartelaId!: string;

  @ApiProperty({ example: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cartelaNumber!: number;
}

export class BulkRegisterCartelasDto {
  @ApiProperty({ type: [BulkRegisterCartelaItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_CARTELAS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => BulkRegisterCartelaItemDto)
  cartelas!: BulkRegisterCartelaItemDto[];
}
