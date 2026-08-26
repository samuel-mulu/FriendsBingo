import { ApiProperty } from '@nestjs/swagger';
import { WinnerPhoneDisplayMode } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateAppDisplayConfigDto {
  @ApiProperty({
    enum: WinnerPhoneDisplayMode,
    example: WinnerPhoneDisplayMode.HIDDEN,
    description:
      'How winner phone numbers appear on player-facing winner cartela screens.',
  })
  @IsEnum(WinnerPhoneDisplayMode)
  winnerPhoneDisplayMode!: WinnerPhoneDisplayMode;
}
