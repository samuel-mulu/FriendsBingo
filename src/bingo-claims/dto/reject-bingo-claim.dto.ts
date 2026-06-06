import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectBingoClaimDto {
  @ApiPropertyOptional({
    example: 'Numbers did not match the called sequence.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
