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

export class CreateDepositDto {
  @ApiProperty({ enum: PaymentProvider, example: PaymentProvider.CBE })
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

  @ApiProperty({ example: '100' })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'amount must be a positive number with up to 2 decimal places',
  })
  amount!: string;

  @ApiProperty({ example: 'FT26152ZN0XY' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(/^(?:[A-Z0-9-]{6,120}|https?:\/\/\S{1,480})$/i, {
    message: 'transactionRef must be a reference ID or an HTTP(S) receipt URL',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  transactionRef!: string;

  @ApiPropertyOptional({ enum: TelebirrReceiptParseStatus })
  @IsOptional()
  @IsEnum(TelebirrReceiptParseStatus)
  receiptParseStatus?: TelebirrReceiptParseStatus;

  @ApiPropertyOptional({ type: TelebirrClientReceiptDto })
  @ValidateIf(
    (dto: CreateDepositDto) =>
      dto.receiptParseStatus === TelebirrReceiptParseStatus.PARSED,
  )
  @ValidateNested()
  @Type(() => TelebirrClientReceiptDto)
  clientReceipt?: TelebirrClientReceiptDto;
}
