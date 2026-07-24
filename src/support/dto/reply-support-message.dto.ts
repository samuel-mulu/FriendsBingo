import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PlayerSupportStatus } from '@prisma/client';
import { Transform } from 'class-transformer';

export class ReplySupportMessageDto {
  @ApiPropertyOptional({
    example: 'Thanks for your feedback. We are looking into this.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  adminReply?: string;

  @ApiPropertyOptional({ enum: PlayerSupportStatus })
  @IsOptional()
  @IsEnum(PlayerSupportStatus)
  status?: PlayerSupportStatus;
}
