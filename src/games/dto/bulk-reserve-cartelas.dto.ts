import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class BulkReserveCartelasDto {
  @ApiProperty({
    type: [String],
    example: ['9bbeb535-bf01-4d6e-823c-e6d5556430d4'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  cartelaIds!: string[];
}
