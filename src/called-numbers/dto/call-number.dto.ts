import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Matches, Max, Min } from 'class-validator';

export class CallNumberDto {
  @ApiProperty({ example: 'B' })
  @IsString()
  @Matches(/^[BINGO]$/, {
    message: 'letter must be one of B, I, N, G, O',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  letter!: string;

  @ApiProperty({ example: 15, minimum: 1, maximum: 75 })
  @IsInt()
  @Min(1)
  @Max(75)
  number!: number;
}
