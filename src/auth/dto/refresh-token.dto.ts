import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ example: 'dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;

  @ApiProperty({ example: 'device-uuid-here', required: false })
  @IsString()
  @IsOptional()
  deviceId?: string;
}
