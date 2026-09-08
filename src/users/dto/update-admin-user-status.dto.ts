import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateAdminUserStatusDto {
  @ApiProperty({ enum: UserStatus, example: UserStatus.BLOCKED })
  @IsEnum(UserStatus)
  status!: UserStatus;

  @ApiPropertyOptional({
    description: 'Required when blocking a player',
    example: 'Multiple accounts on the same device',
  })
  @ValidateIf((dto: UpdateAdminUserStatusDto) => dto.status === UserStatus.BLOCKED)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason?: string;
}
