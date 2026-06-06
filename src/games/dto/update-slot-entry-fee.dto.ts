import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

const decimalMoneyPattern = /^\d+(\.\d{1,2})?$/;

export class UpdateSlotEntryFeeDto {
  @ApiProperty({ example: '10' })
  @Matches(decimalMoneyPattern, {
    message: 'entryFee must be a positive number with up to 2 decimal places',
  })
  entryFee!: string;
}
