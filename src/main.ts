import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { SocketIoRedisService } from './realtime/socket-io-redis.service';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  setupApp(app);
  app.enableShutdownHooks();

  try {
    const redis = app.get(SocketIoRedisService);
    if (redis.enabled) {
      await redis.initialize();
      app.useWebSocketAdapter(new RedisIoAdapter(app, redis));
      await app.init();
      await redis.verifyReady();
    }
    const port = configService.get<number>('PORT') ?? 3002;
    await app.listen(port, '0.0.0.0');
  } catch {
    await app.close();
    // Do not print raw Redis errors or URLs, which can contain credentials.
    console.error(
      'Backend startup failed before listen; check dependency readiness',
    );
    process.exitCode = 1;
  }
}
bootstrap();
