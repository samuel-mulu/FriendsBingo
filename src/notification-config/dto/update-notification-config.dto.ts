import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateNotificationConfigDto {
  @ApiProperty({
    example: true,
    description:
      'Global server kill switch for Firebase push notifications (game events, winners, deposits, etc.).',
  })
  @IsBoolean()
  pushNotificationsEnabled!: boolean;
}
