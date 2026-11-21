import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GameOperationMode } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  REGISTRATION_DURATION_MAX_SECONDS,
  REGISTRATION_DURATION_MIN_SECONDS,
} from '../../game-timing-config/game-timing-config.defaults';

export class UpdateSlotOperationModeDto {
  @ApiProperty({ enum: GameOperationMode })
  @IsEnum(GameOperationMode)
  operationMode!: GameOperationMode;

  @ApiPropertyOptional({
    example: 60,
    description:
      'AUTO mode registration window in seconds (minimum 10, no practical maximum)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(REGISTRATION_DURATION_MIN_SECONDS)
  @Max(REGISTRATION_DURATION_MAX_SECONDS)
  registrationDurationSeconds?: number;

  @ApiPropertyOptional({
    example: 7,
    description: 'AUTO mode auto-call interval in seconds',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(60)
  autoCallIntervalSeconds?: number;
}
