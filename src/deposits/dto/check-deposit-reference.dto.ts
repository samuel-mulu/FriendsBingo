import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CheckDepositReferenceDto {
  @ApiProperty({ enum: PaymentProvider, example: PaymentProvider.CBE })
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

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
