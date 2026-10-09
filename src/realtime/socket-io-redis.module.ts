import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SocketIoRedisService } from './socket-io-redis.service';

@Module({
  imports: [ConfigModule],
  providers: [SocketIoRedisService],
  exports: [SocketIoRedisService],
})
export class SocketIoRedisModule {}
