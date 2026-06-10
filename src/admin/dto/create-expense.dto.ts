import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateExpenseDto {
  @ApiProperty({ example: '150.00' })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'amount must be a positive number with up to 2 decimal places',
  })
  amount!: string;

  @ApiProperty({ example: 'Office supplies' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason!: string;

  @ApiPropertyOptional({ example: 'Printer paper and toner' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    example: '2026-06-10',
    description: 'Expense date in YYYY-MM-DD or ISO datetime',
  })
  @IsOptional()
  @IsDateString()
  expenseDate?: string;
}
