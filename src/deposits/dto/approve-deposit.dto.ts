import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class ApproveDepositDto {
  @ApiProperty({ example: '123456', description: '6-digit admin approval PIN' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'Approval PIN must be exactly 6 digits' })
  approvalPin!: string;
}
