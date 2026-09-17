import { ApiProperty } from '@nestjs/swagger';
import { GamePushMode } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @ApiProperty({
    enum: GamePushMode,
    example: GamePushMode.REGISTERED_ONLY,
    description:
      'ALWAYS = all game alerts including registration broadcasts; REGISTERED_ONLY = only session pushes when playing; OFF = no game pushes',
  })
  @IsEnum(GamePushMode)
  gamePushMode!: GamePushMode;
}
