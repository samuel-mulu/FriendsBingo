import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { TelebirrClientReceiptDto } from './telebirr-client-receipt.dto';
import { TelebirrReceiptParseStatus } from './telebirr-receipt-parse-status.enum';

export class CheckDepositReferenceDto {
  @ApiProperty({ enum: PaymentProvider, example: PaymentProvider.TELEBIRR })
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

  @ApiProperty({ example: 'DFF3WLQB6R' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(/^[A-Z0-9-]{6,120}$/i, {
    message: 'transactionRef must be 6 to 120 alphanumeric characters',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  transactionRef!: string;

  @ApiPropertyOptional({ example: '10' })
  @ValidateIf(
    (dto: CheckDepositReferenceDto) =>
      dto.receiptParseStatus === TelebirrReceiptParseStatus.PARSED,
  )
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'amount must be a positive number with up to 2 decimal places',
  })
  amount?: string;

  @ApiPropertyOptional({ enum: TelebirrReceiptParseStatus })
  @IsOptional()
  @IsEnum(TelebirrReceiptParseStatus)
  receiptParseStatus?: TelebirrReceiptParseStatus;

  @ApiPropertyOptional({ type: TelebirrClientReceiptDto })
  @ValidateIf(
    (dto: CheckDepositReferenceDto) =>
      dto.receiptParseStatus === TelebirrReceiptParseStatus.PARSED,
  )
  @ValidateNested()
  @Type(() => TelebirrClientReceiptDto)
  clientReceipt?: TelebirrClientReceiptDto;
}
