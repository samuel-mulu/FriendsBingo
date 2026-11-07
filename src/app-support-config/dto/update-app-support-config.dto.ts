import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateAppSupportConfigDto {
  @ApiPropertyOptional({
    example: '0961355799',
    description: 'Primary support phone number shown in the player app.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  phoneNumber1?: string;

  @ApiPropertyOptional({
    example: '0983299318',
    description: 'Secondary support phone number shown in the player app.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber2?: string;

  @ApiPropertyOptional({
    example: 'friendschewata',
    description: 'Telegram username without @ for Contact Us.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  telegramUsername?: string;

  @ApiPropertyOptional({
    description: 'Terms and conditions body shown in the player app.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50000)
  termsBody?: string;
}
