import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CartelaPaymentSource } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class RegisterCartelaDto {
  @ApiProperty({ example: '9bbeb535-bf01-4d6e-823c-e6d5556430d4' })
  @IsUUID()
  cartelaId!: string;

  @ApiPropertyOptional({
    enum: [
      CartelaPaymentSource.MONEY_WALLET,
      CartelaPaymentSource.BIG_GAME_TICKET,
    ],
    description:
      'BIG_GAME only: pay with wallet money or a Big Ticket. Defaults to MONEY_WALLET.',
  })
  @IsOptional()
  @IsEnum(CartelaPaymentSource)
  paymentSource?: CartelaPaymentSource;
}
