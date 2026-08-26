import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { DECIMAL_MONEY_PATTERN } from '../normal-economics.util';

export class UpdateSlotEconomicsDto {
  @ApiProperty({ example: '10' })
  @Matches(DECIMAL_MONEY_PATTERN, {
    message: 'entryFee must be a positive number with up to 2 decimal places',
  })
  entryFee!: string;

  @ApiProperty({ example: '2' })
  @Matches(DECIMAL_MONEY_PATTERN, {
    message:
      'companyFeePerCartela must be a positive number with up to 2 decimal places',
  })
  companyFeePerCartela!: string;
}
