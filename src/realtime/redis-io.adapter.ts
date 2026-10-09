import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import type { Server, ServerOptions } from 'socket.io';
import { SocketIoRedisService } from './socket-io-redis.service';

export class RedisIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly redis: SocketIoRedisService,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: Partial<ServerOptions>): Server {
    const originalAllowRequest = options?.allowRequest;
    const server = super.createIOServer(port, {
      ...options,
      allowRequest: (request, callback) => {
        if (!this.redis.isReady())
          return callback('Realtime temporarily unavailable', false);
        if (originalAllowRequest)
          return originalAllowRequest(request, callback);
        callback(null, true);
      },
    }) as Server;
    this.redis.attach(server);
    return server;
  }
}
