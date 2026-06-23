import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl, MaxLength } from 'class-validator';

export class ApproveWithdrawalDto {
  @ApiProperty({
    example: 'https://bank.example.com/receipt/abc123',
    description: 'URL to the payout transaction proof',
  })
  @IsString()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  payoutTransactionUrl!: string;
}
