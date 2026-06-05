import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateGameDto {
  @ApiProperty({ example: '6b7130c0-0f7d-4c42-9a31-d8e9a3920b95' })
  @IsUUID()
  gameRuleId!: string;

  @ApiProperty({ example: '10' })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'entryFee must be a positive number with up to 2 decimal places',
  })
  entryFee!: string;

  @ApiProperty({ example: '500' })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message:
      'prizeAmount must be a positive number with up to 2 decimal places',
  })
  prizeAmount!: string;

  @ApiProperty({ example: 1, required: false })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(100000)
  playOrder?: number;
}
