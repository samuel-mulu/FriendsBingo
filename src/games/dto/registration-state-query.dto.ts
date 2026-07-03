import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const REGISTRATION_STATE_VIEWS = ['full', 'slim'] as const;
export type RegistrationStateView =
  (typeof REGISTRATION_STATE_VIEWS)[number];

export class RegistrationStateQueryDto {
  @ApiPropertyOptional({
    enum: REGISTRATION_STATE_VIEWS,
    default: 'full',
    description:
      'slim omits duplicate reservedCartelasSummary and adds registration counts',
  })
  @IsOptional()
  @IsIn(REGISTRATION_STATE_VIEWS)
  view?: RegistrationStateView;
}
