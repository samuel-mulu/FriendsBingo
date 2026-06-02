import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

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
  @MaxLength(120)
  @Matches(/^[A-Z0-9-]{6,120}$/i, {
    message: 'transactionRef must be 6 to 120 alphanumeric characters',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  transactionRef!: string;
}
