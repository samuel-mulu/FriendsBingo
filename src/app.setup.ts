import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { SuccessResponseInterceptor } from './common/interceptors/success-response.interceptor';
import { resolveHttpCorsOptions } from './config/cors.config';
import { RequestContextService } from './observability/request-context.service';

export function setupApp(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const requestContext = app.get(RequestContextService);

  const expressApp = app.getHttpAdapter().getInstance() as {
    set: (setting: string, value: unknown) => void;
  };
  expressApp.set('trust proxy', 1);

  app.use((request, response, next) => {
    const req = request;
    const requestId = req.header('x-request-id')?.trim() || randomUUID();

    req.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);

    requestContext.run(
      {
        requestId,
        method: req.method,
        path: req.originalUrl ?? req.url,
      },
      () => next(),
    );
  });

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
    app.get(RequestLoggingInterceptor),
    app.get(SuccessResponseInterceptor),
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
