import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlayerSupportCategory } from '@prisma/client';
import { Transform } from 'class-transformer';

export class AdminCreateSupportMessageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiProperty({
    example: 'We noticed unusual activity on your account. Please contact support.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  adminReply!: string;

  @ApiPropertyOptional({
    enum: PlayerSupportCategory,
    default: PlayerSupportCategory.OTHER,
  })
  @IsOptional()
  @IsEnum(PlayerSupportCategory)
  category?: PlayerSupportCategory;
}
