import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class TelebirrClientReceiptDto {
  @ApiProperty({ example: 'DFF7WNHH5N' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  invoiceNumber!: string;

  @ApiProperty({ example: 'Completed' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  transactionStatus!: string;

  @ApiProperty({ example: '10.00' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  settledAmount!: string;

  @ApiProperty({ example: 'Yonas Shiferaw Yowhans' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  creditedPartyName!: string;

  @ApiProperty({ example: '2519****3287' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  creditedPartyAccountNo!: string;
}
