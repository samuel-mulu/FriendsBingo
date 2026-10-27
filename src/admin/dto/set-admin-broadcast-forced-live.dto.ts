import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetAdminBroadcastForcedLiveDto {
  @ApiProperty({
    description:
      'FORCED broadcasts only. When true, players see the blocking modal; when false, hidden from players but kept in admin.',
  })
  @IsBoolean()
  live!: boolean;
}
