import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class UpdateAppVersionConfigDto {
  @ApiProperty({
    description:
      "What's new bullets shown on the player app update card. One bullet per line.",
    example: 'Bug fixes\nPerformance improvements\nNew game modes',
  })
  @IsString()
  @MaxLength(10000)
  releaseNotes!: string;
}
