import { ApiProperty } from '@nestjs/swagger';
import { GameStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateGameStatusDto {
  @ApiProperty({ enum: GameStatus, example: GameStatus.CHECKING })
  @IsEnum(GameStatus)
  status!: GameStatus;
}
