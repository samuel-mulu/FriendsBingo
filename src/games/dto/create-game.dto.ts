import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateGameDto {
  @ApiProperty({ example: '6b7130c0-0f7d-4c42-9a31-d8e9a3920b95' })
  @IsUUID()
  gameRuleId!: string;
}
