import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OtpPurpose } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';

export class RequestOtpDto {
  @ApiProperty({ example: '0962520885' })
  @IsString()
  @Matches(/^\d{9,15}$/)
  phone!: string;

  @ApiPropertyOptional({ enum: OtpPurpose, default: OtpPurpose.LOGIN })
  @IsOptional()
  @IsEnum(OtpPurpose)
  purpose?: OtpPurpose;
}
