import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class AdminDevicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search by device id, phone number, or player name',
    example: '0911',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Only return devices linked to more than one account',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  duplicatesOnly?: boolean = false;
}
