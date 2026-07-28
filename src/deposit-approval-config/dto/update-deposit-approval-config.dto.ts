import { ApiProperty } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
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

  @ApiProperty({ enum: ['automatic', 'manual', 'local'] })
  @IsIn(['automatic', 'manual', 'local'])
  approvalMode!: DepositApprovalModeApi;
}

export class UpdateDepositApprovalConfigDto {
  @ApiProperty({ type: [UpdateDepositApprovalProviderDto] })
  @ValidateNested({ each: true })
  @Type(() => UpdateDepositApprovalProviderDto)
  providers!: UpdateDepositApprovalProviderDto[];
}
