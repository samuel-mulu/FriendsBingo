import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ReserveCartelaDto {
  @ApiPropertyOptional({
    default: true,
    description:
      'When false, cancels other active holds for this user in the session before reserving.',
  })
  @IsOptional()
  @IsBoolean()
  preserveOtherReservations?: boolean;
}
