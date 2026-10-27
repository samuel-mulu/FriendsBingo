import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class RegistrationCashbackTierDto {
  @ApiProperty({ example: 50 })
  @IsInt()
  @Min(1)
  minCartelasInSession!: number;

  @ApiProperty({ example: '10' })
  @IsString()
  @IsNotEmpty()
  rewardEtb!: string;
}

export class UpdateRegistrationCashbackConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ type: [RegistrationCashbackTierDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegistrationCashbackTierDto)
  tiers?: RegistrationCashbackTierDto[];
}
