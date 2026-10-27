import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangeDepositManualApprovalPinDto {
  @ApiProperty({
    example: '121921',
    description: 'Current 6-digit PIN used to approve manual deposits',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Current PIN must be exactly 6 digits' })
  currentPin!: string;

  @ApiProperty({
    example: '654321',
    description: 'New 6-digit PIN for manual deposit approval',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'New PIN must be exactly 6 digits' })
  newPin!: string;
}
