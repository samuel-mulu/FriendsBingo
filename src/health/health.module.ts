import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { SocketIoRedisModule } from '../realtime/socket-io-redis.module';

@Module({
  imports: [PrismaModule, SocketIoRedisModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
