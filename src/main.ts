import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  setupApp(app);
  app.enableShutdownHooks();

  const port = configService.get<number>('PORT') ?? 3002;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
