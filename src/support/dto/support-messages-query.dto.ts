import { ApiPropertyOptional } from '@nestjs/swagger';
import { PlayerSupportStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class SupportMessagesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PlayerSupportStatus })
  @IsOptional()
  @IsEnum(PlayerSupportStatus)
  status?: PlayerSupportStatus;
}
