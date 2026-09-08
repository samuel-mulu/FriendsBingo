import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeviceMetaDto {
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

export type RefreshTokenDeviceMeta = {
  platform?: string | null;
  deviceLabel?: string | null;
  userAgent?: string | null;
};
