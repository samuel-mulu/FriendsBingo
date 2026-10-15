import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateAdminUserFeatureGrantsDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Admin grant for Auto Mark access.',
  })
  @IsOptional()
  @IsBoolean()
  autoMarkGranted?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Admin grant for Auto Bingo access.',
  })
  @IsOptional()
  @IsBoolean()
  autoBingoGranted?: boolean;
}
