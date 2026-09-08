import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: '12345678', minLength: 6, maxLength: 72 })
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  currentPassword!: string;

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
