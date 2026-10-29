import { ApiPropertyOptional } from '@nestjs/swagger';
import { WinnerPhoneDisplayMode } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class UpdateAppDisplayConfigDto {
  @ApiPropertyOptional({
    enum: WinnerPhoneDisplayMode,
    example: WinnerPhoneDisplayMode.HIDDEN,
    description:
      'How winner phone numbers appear on player-facing winner cartela screens.',
  })
  @IsOptional()
  @IsEnum(WinnerPhoneDisplayMode)
  winnerPhoneDisplayMode?: WinnerPhoneDisplayMode;

  @ApiPropertyOptional({
    example: true,
    description:
      'When false, the Flutter app hides all Big Game promotion UI (centered card on shell tabs and the Games screen strip).',
  })
  @IsOptional()
  @IsBoolean()
  bigGamePromotionCardEnabled?: boolean;
}
