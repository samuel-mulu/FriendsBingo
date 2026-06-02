import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class RegisterCartelaDto {
  @ApiProperty({ example: '9bbeb535-bf01-4d6e-823c-e6d5556430d4' })
  @IsUUID()
  cartelaId!: string;
}
