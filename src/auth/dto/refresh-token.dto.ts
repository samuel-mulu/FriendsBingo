import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ example: 'dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;

  @ApiPropertyOptional({ example: 'device-uuid-here' })
  @IsString()
  @IsOptional()
  @MaxLength(128)
  deviceId?: string;

  @ApiPropertyOptional({ example: 'android' })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  platform?: string;

  @ApiPropertyOptional({ example: 'Samsung A54' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  deviceLabel?: string;

  @ApiPropertyOptional({ example: 'FriendsBingo/1.0.4' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  userAgent?: string;
}
