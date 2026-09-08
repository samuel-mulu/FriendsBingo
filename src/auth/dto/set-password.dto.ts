import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SetPasswordDto {
  @ApiProperty({ example: '483920', minLength: 4, maxLength: 8 })
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'otp must be 4 to 8 digits' })
  otp!: string;

  @ApiProperty({ example: 'newSecurePass1', minLength: 6, maxLength: 72 })
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  newPassword!: string;

  @ApiPropertyOptional({
    description:
      'Current refresh token to keep this device signed in. Other sessions are revoked.',
  })
  @IsString()
  @IsOptional()
  refreshToken?: string;
}
