import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class MoveGameQueueDto {
  @ApiProperty({ enum: ['up', 'down'] })
  @IsIn(['up', 'down'])
  direction!: 'up' | 'down';
}
