import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreateGameDto {
  @ApiProperty({ example: 'Evening Bingo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ApiProperty({ example: 'HALF_HOUSE' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  gameType!: string;

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

  @ApiProperty({ example: '2026-06-01T18:00:00.000Z' })
  @IsDateString()
  startsAt!: string;
}
