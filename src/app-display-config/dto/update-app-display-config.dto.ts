import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateAppDisplayConfigDto {
  @ApiProperty({
    example: false,
    description:
      'When true, winner-results include the winner phone in local format for players.',
  })
  @IsBoolean()
  showWinnerPhoneNumber!: boolean;
}
