import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateFeatureSettingsDto {
  @ApiPropertyOptional({
    example: true,
    description:
      'Player preference for Auto Mark. Enabling requires autoMarkGranted=true.',
  })
  @IsOptional()
  @IsBoolean()
  autoMarkEnabled?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'Player preference for Auto Bingo. Enabling requires autoBingoGranted=true.',
  })
  @IsOptional()
  @IsBoolean()
  autoBingoEnabled?: boolean;
}
