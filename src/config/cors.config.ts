import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { parseCorsOrigins } from './env.validation';

export function resolveHttpCorsOptions(corsOrigins: string): CorsOptions {
  return {
    origin: parseCorsOrigins(corsOrigins),
    credentials: true,
  };
}

export function resolveWebSocketCorsOptions(
  corsOrigins: string,
): CorsOptions['origin'] {
  return parseCorsOrigins(corsOrigins);
}

export function readCorsOriginsFromEnv(): string {
  return process.env.CORS_ORIGINS ?? 'http://localhost:3000';
}
