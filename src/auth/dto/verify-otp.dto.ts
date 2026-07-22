import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ example: '0962520885' })
  @IsString()
  @Matches(/^\d{9,15}$/)
  phone!: string;

  @ApiProperty({ example: '1234', description: '4-digit GeezSMS OTP' })
  @IsString()
  @Matches(/^\d{4}$/)
  otp!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deviceId?: string;
}
