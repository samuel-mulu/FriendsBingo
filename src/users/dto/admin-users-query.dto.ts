import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class AdminUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserRole, example: UserRole.PLAYER })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
