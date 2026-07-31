import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CheckDepositReferenceDto {
  @ApiProperty({ enum: PaymentProvider, example: PaymentProvider.CBE })
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

  @ApiProperty({ example: 'FT26152ZN0XY' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(/^(?:[A-Z0-9-]{6,120}|https?:\/\/\S{1,480})$/i, {
    message: 'transactionRef must be a reference ID or an HTTP(S) receipt URL',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  transactionRef!: string;
}
