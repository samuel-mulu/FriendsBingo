import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { MAX_BULK_CARTELAS_PER_REQUEST } from '../registration-limits';

export class BulkReserveCartelasDto {
  @ApiProperty({
    type: [String],
    example: ['9bbeb535-bf01-4d6e-823c-e6d5556430d4'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_CARTELAS_PER_REQUEST)
  @IsUUID('4', { each: true })
  cartelaIds!: string[];
}
