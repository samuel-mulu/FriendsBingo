import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectDepositDto {
  @ApiProperty({ example: 'Transaction receipt is invalid' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  rejectionReason!: string;
}
