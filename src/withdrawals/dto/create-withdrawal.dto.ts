import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const supportedWithdrawalProviders = [
  PaymentProvider.TELEBIRR,
  PaymentProvider.CBE,
] as const;

export class CreateWithdrawalDto {
  @ApiProperty({
    enum: supportedWithdrawalProviders,
    example: PaymentProvider.TELEBIRR,
  })
  @IsIn(supportedWithdrawalProviders)
  provider!: PaymentProvider;

  @ApiProperty({ example: '100' })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'amount must be a positive number with up to 2 decimal places',
  })
  amount!: string;

  @ApiPropertyOptional({ example: '0912345678' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^\d{10,15}$/, {
    message: 'receiverPhone must contain 10 to 15 digits',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  receiverPhone?: string;

  @ApiPropertyOptional({ example: '1002003004005006' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  receiverAccount?: string;
}
