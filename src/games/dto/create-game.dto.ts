import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GameCategory, GameOperationMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

const decimalMoneyPattern = /^\d+(\.\d{1,2})?$/;

export class CreateGameDto {
  @ApiProperty({ example: '6b7130c0-0f7d-4c42-9a31-d8e9a3920b95' })
  @IsUUID()
  gameRuleId!: string;

  @ApiPropertyOptional({ enum: GameCategory, default: GameCategory.NORMAL })
  @IsOptional()
  @IsEnum(GameCategory)
  category?: GameCategory;

  @ApiPropertyOptional({
    example: '5000',
    description: 'Required for BONUS, BIG_GOTD, and BIG_GAME games',
  })
  @IsOptional()
  @Matches(decimalMoneyPattern, {
    message:
      'fixedPrizeAmount must be a positive number with up to 2 decimal places',
  })
  fixedPrizeAmount?: string;

  @ApiPropertyOptional({
    example: '25',
    description: 'Required for BIG_GOTD and BIG_GAME creation',
  })
  @IsOptional()
  @Matches(decimalMoneyPattern, {
    message: 'entryFee must be a positive number with up to 2 decimal places',
  })
  entryFee?: string;

  @ApiPropertyOptional({
    example: 5,
    description: 'Defaults to 5 for BONUS and BIG_GOTD games',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxCartelasPerPlayer?: number;

  @ApiPropertyOptional({
    example: '2026-07-01T09:00:00.000Z',
    description: 'BIG_GAME registration open time',
  })
  @IsOptional()
  @IsDateString()
  registrationOpensAt?: string;

  @ApiPropertyOptional({
    example: '2026-07-01T12:00:00.000Z',
    description: 'BIG_GAME actual play start time',
  })
  @IsOptional()
  @IsDateString()
  playStartAt?: string;

  @ApiPropertyOptional({
    enum: GameOperationMode,
    default: GameOperationMode.MANUAL,
  })
  @IsOptional()
  @IsEnum(GameOperationMode)
  operationMode?: GameOperationMode;

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
