import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { SuccessResponseInterceptor } from './common/interceptors/success-response.interceptor';
import { resolveHttpCorsOptions } from './config/cors.config';

export function setupApp(app: INestApplication): void {
  const configService = app.get(ConfigService);

  const expressApp = app.getHttpAdapter().getInstance() as {
    set: (setting: string, value: unknown) => void;
  };
  expressApp.set('trust proxy', 1);

  app.use(helmet());
  app.enableCors(
    resolveHttpCorsOptions(configService.getOrThrow<string>('CORS_ORIGINS')),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    new RequestLoggingInterceptor(),
    new SuccessResponseInterceptor(),
  );

  const swaggerEnabled =
    configService.get<string>('NODE_ENV') !== 'production' ||
    configService.get<boolean>('SWAGGER_ENABLED') === true;

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Friends Bingo API')
      .setDescription('Friends Bingo backend API')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);

    SwaggerModule.setup('docs', app, swaggerDocument, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }
}
