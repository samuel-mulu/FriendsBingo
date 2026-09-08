import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DeviceMetaDto } from './device-meta.dto';

export class TelegramAuthPayloadDto {
  @ApiProperty({ example: 123456789 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number;

  @ApiPropertyOptional({ example: 'Abebe' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  first_name?: string;

  @ApiPropertyOptional({ example: 'Kebede' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  last_name?: string;

  @ApiPropertyOptional({ example: 'abebe' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  username?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(512)
  photo_url?: string;

  @ApiProperty({ example: 1710000000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  auth_date!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  hash!: string;
}

export class TelegramStartDto extends DeviceMetaDto {
  @ApiProperty({ type: TelegramAuthPayloadDto })
  @ValidateNested()
  @Type(() => TelegramAuthPayloadDto)
  telegram!: TelegramAuthPayloadDto;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(128)
  deviceId?: string;
}

export class TelegramRequestOtpDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  ticket!: string;

  @ApiProperty({ example: '0912345678' })
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;
}

export class TelegramCompleteDto extends DeviceMetaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  ticket!: string;

  @ApiProperty({ example: '0912345678' })
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;

  @ApiProperty({ example: '483920' })
  @IsString()
  @IsNotEmpty()
  otp!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(128)
  deviceId?: string;
}

export class TelegramLinkDto {
  @ApiProperty({ type: TelegramAuthPayloadDto })
  @ValidateNested()
  @Type(() => TelegramAuthPayloadDto)
  telegram!: TelegramAuthPayloadDto;
}
