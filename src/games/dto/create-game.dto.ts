import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GameOperationMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateGameDto {
  @ApiProperty({ example: '6b7130c0-0f7d-4c42-9a31-d8e9a3920b95' })
  @IsUUID()
  gameRuleId!: string;

  @ApiPropertyOptional({ enum: GameOperationMode, default: GameOperationMode.MANUAL })
  @IsOptional()
  @IsEnum(GameOperationMode)
  operationMode?: GameOperationMode;

  @ApiPropertyOptional({ example: 60, description: 'AUTO mode registration window in seconds' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(600)
  registrationDurationSeconds?: number;

  @ApiPropertyOptional({ example: 7, description: 'AUTO mode auto-call interval in seconds' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(60)
  autoCallIntervalSeconds?: number;
}
