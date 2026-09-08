import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { DeviceMetaDto } from './device-meta.dto';

export class ListSessionsDto extends DeviceMetaDto {
  @ApiPropertyOptional({
    description: 'Current refresh token used to mark isCurrent',
  })
  @IsString()
  @IsOptional()
  refreshToken?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(128)
  deviceId?: string;
}

export class LogoutOtherSessionsDto {
  @ApiProperty({
    description: 'Current refresh token to keep active',
  })
  @IsString()
  refreshToken!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(128)
  deviceId?: string;
}
