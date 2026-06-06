import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: '0912345678' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10,15}$/, {
    message: 'phoneNumber must contain 10 to 15 digits',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  phoneNumber!: string;

  @ApiProperty({ example: '12345678', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}
