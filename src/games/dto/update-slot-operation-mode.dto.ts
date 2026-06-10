import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GameOperationMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class UpdateSlotOperationModeDto {
  @ApiProperty({ enum: GameOperationMode })
  @IsEnum(GameOperationMode)
  operationMode!: GameOperationMode;

  @ApiPropertyOptional({
    example: 60,
    description: 'AUTO mode registration window in seconds',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(600)
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
