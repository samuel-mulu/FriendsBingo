import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class UnregisterDeviceDto {
  @ApiProperty({
    example:
      'dYVhSl2HTJKsM8o4sD7K0L:APA91bHh1W4V5T6Y7Z8AaBbCcDdEeFfGgHhIiJjKkLl',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  token!: string;
}
