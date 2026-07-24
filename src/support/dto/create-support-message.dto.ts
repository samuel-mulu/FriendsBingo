import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PlayerSupportCategory } from '@prisma/client';
import { Transform } from 'class-transformer';

export class CreateSupportMessageDto {
  @ApiProperty({
    enum: PlayerSupportCategory,
    example: PlayerSupportCategory.FEEDBACK,
  })
  @IsEnum(PlayerSupportCategory)
  category!: PlayerSupportCategory;

  @ApiProperty({ example: 'The app is great but I had trouble registering.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  message!: string;
}
