import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

const decimalMoneyPattern = /^\d+(\.\d{1,2})?$/;

export class StartSessionDto {
  @ApiPropertyOptional({ example: '10' })
  @IsOptional()
  @Matches(decimalMoneyPattern, {
    message: 'entryFee must be a positive number with up to 2 decimal places',
  })
  entryFee?: string;

  @ApiPropertyOptional({ example: '8' })
  @IsOptional()
  @Matches(decimalMoneyPattern, {
    message:
      'prizePerCartela must be a positive number with up to 2 decimal places',
  })
  prizePerCartela?: string;

  @ApiPropertyOptional({ example: '2' })
  @IsOptional()
  @Matches(decimalMoneyPattern, {
    message:
      'companyFeePerCartela must be a positive number with up to 2 decimal places',
  })
  companyFeePerCartela?: string;
}
