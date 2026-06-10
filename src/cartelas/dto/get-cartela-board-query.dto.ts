import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class GetCartelaBoardQueryDto {
  @ApiProperty({
    description:
      'Game session the player is registering in or already owns this cartela for',
  })
  @IsUUID()
  sessionId!: string;
}
