import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { DepositApprovalModeApi } from '../deposit-approval-config.types';

export class UpdateDepositApprovalProviderDto {
  @ApiProperty({ enum: PaymentProvider })
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

  @ApiProperty({ example: true })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({
    enum: ['automatic', 'manual', 'local', 'local_with_fallback'],
  })
  @IsIn(['automatic', 'manual', 'local', 'local_with_fallback'])
  approvalMode!: DepositApprovalModeApi;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  fallbackThreshold?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  fallbackWindowMinutes?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  fallbackDurationMinutes?: number;
}

export class UpdateDepositApprovalConfigDto {
  @ApiProperty({ type: [UpdateDepositApprovalProviderDto] })
  @ValidateNested({ each: true })
  @Type(() => UpdateDepositApprovalProviderDto)
  providers!: UpdateDepositApprovalProviderDto[];
}
