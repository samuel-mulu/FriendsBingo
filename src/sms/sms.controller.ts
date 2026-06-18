import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('sms')
@Controller('sms')
export class SmsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('geezsms/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'GeezSMS delivery callback webhook' })
  async geezSmsCallback(@Body() payload: Record<string, unknown>) {
    await this.prisma.smsDeliveryLog.create({
      data: {
        provider: 'geezsms',
        phone: typeof payload.phone === 'string' ? payload.phone : null,
        payload: payload as Prisma.InputJsonValue,
      },
    });

    return { received: true };
  }
}
