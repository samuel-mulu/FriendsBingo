import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GameCategory, GameOperationMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { FORCE_BIG_GAME_TICKET_COUNTS } from '../../bingo-claims/force-big-game-tickets.util';

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
    description:
      'Required for BONUS, BIG_GOTD, BIG_GAME, and CHAIN_GAME games. For CHAIN_GAME this is the whole-chain pool and must equal the sum of roundPrizes.',
  })
  @IsOptional()
  @Matches(decimalMoneyPattern, {
    message:
      'fixedPrizeAmount must be a positive number with up to 2 decimal places',
  })
  fixedPrizeAmount?: string;

  @ApiPropertyOptional({
    example: '25',
    description: 'Required for BIG_GOTD, BIG_GAME, and CHAIN_GAME creation',
  })
  @IsOptional()
  @Matches(decimalMoneyPattern, {
    message: 'entryFee must be a positive number with up to 2 decimal places',
  })
  entryFee?: string;

  @ApiPropertyOptional({
    example: 5,
    description:
      'Defaults to 5 for BONUS and BIG_GOTD. Required for CHAIN_GAME. Optional for NORMAL (omit for unlimited). Ignored for BIG_GAME.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxCartelasPerPlayer?: number;

  @ApiPropertyOptional({
    example: 1,
    description:
      'BIG_GAME: number of play rounds (default 1, max 10). CHAIN_GAME: number of prize rounds inside one continuous draw (minimum 2).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  roundCount?: number;

  @ApiPropertyOptional({
    example: ['20000', '30000', '50000'],
    description:
      'BIG_GAME / CHAIN_GAME: prize per round; length must equal roundCount; sum must equal fixedPrizeAmount',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @Matches(decimalMoneyPattern, {
    each: true,
    message:
      'each roundPrize must be a positive number with up to 2 decimal places',
  })
  roundPrizes?: string[];

  @ApiPropertyOptional({
    example: [
      '6b7130c0-0f7d-4c42-9a31-d8e9a3920b95',
      '7c8241d1-1e8e-5d53-0b42-e9f0b4a31c06',
    ],
    description:
      'BIG_GAME / CHAIN_GAME: GameRule id per round; length must equal roundCount; [0] must equal gameRuleId. Defaults to [gameRuleId] when omitted.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  roundGameRuleIds?: string[];

  @ApiPropertyOptional({
    example: 300,
    description:
      'Required when roundCount > 1. BIG_GAME: seconds after a round finalize before the next round session auto-starts (60-3600). CHAIN_GAME: seconds the live session pauses on the winner reveal before the next round resumes calling (5-300). Per-category bounds are enforced in GamesService.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(3600)
  interRoundDelaySeconds?: number;

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
    description:
      'NORMAL / BONUS / BIG_GOTD / CHAIN_GAME: force-grant Big Tickets from winner prizes into the current Big Game',
  })
  @IsOptional()
  @IsBoolean()
  forceBigGameEnabled?: boolean;

  @ApiPropertyOptional({
    example: 2,
    description:
      'NORMAL / BONUS / BIG_GOTD / CHAIN_GAME: total Big Tickets pool to force-grant from winner prizes (1 winner gets all; 2 winners split evenly except pool 1 gives 1 each; 3+ winners get none). Allowed: 1, or an even integer from 2 to 10.',
  })
  @ValidateIf((dto: CreateGameDto) => dto.forceBigGameEnabled === true)
  @Type(() => Number)
  @IsInt()
  @IsIn(FORCE_BIG_GAME_TICKET_COUNTS)
  forceBigGameCartelaCount?: number;

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
