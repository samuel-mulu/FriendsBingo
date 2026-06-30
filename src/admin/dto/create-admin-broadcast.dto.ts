import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdminBroadcastCategory } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAdminBroadcastDto {
  @ApiProperty({ example: 'Scheduled maintenance' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'The app will be unavailable tonight from 10 PM to 11 PM.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body!: string;

  @ApiPropertyOptional({
    enum: AdminBroadcastCategory,
    example: AdminBroadcastCategory.DISMISSIBLE,
    description:
      'DISMISSIBLE: player can dismiss. PERSISTENT: always visible in inbox. FORCED: blocking full-screen modal until admin deletes.',
  })
  @IsOptional()
  @IsEnum(AdminBroadcastCategory)
  category?: AdminBroadcastCategory;
}
