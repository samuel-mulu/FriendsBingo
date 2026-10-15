import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { BingoClaimSource } from './bingo-claim-source';

export class CreateBingoClaimDto {
  @ApiProperty({ example: '9bbeb535-bf01-4d6e-823c-e6d5556430d4' })
  @IsUUID()
  gameCartelaId!: string;

  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'Client-generated idempotency key for this claim attempt',
  })
  @IsUUID()
  claimAttemptId!: string;

  @ApiPropertyOptional({
    description: 'Client tap timestamp (diagnostic only; server receivedAt is authoritative)',
  })
  @IsOptional()
  @IsDateString()
  clientTapAt?: string;

  @ApiPropertyOptional({
    enum: BingoClaimSource,
    default: BingoClaimSource.MANUAL,
    description:
      'Claim initiation source. Missing defaults to MANUAL. AUTO requires server-side Auto Bingo grant+enabled.',
  })
  @IsOptional()
  @IsEnum(BingoClaimSource)
  claimSource?: BingoClaimSource;
}
