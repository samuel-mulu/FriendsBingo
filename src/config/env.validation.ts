import * as Joi from 'joi';

const LOCALHOST_CORS_PATTERN = /^https?:\/\/localhost:\*$/;
const HTTP_ORIGIN_PATTERN = /^https?:\/\/.+/;

export type CorsOriginsValidationResult =
  | { ok: true; normalized: string }
  | { ok: false; message: string };

export function validateCorsOrigins(
  value: string,
  options: { production: boolean },
): CorsOriginsValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      ok: false,
      message:
        'CORS_ORIGINS is required. Set comma-separated frontend URLs, e.g. https://friends-bingo-admin.vercel.app',
    };
  }

  if (trimmed === '*') {
    return {
      ok: false,
      message:
        'CORS_ORIGINS cannot be "*" in production. List each allowed frontend origin explicitly, e.g. https://friends-bingo-admin.vercel.app,https://your-flutter-web.app',
    };
  }

  const origins = trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return {
      ok: false,
      message: 'CORS_ORIGINS must include at least one origin URL.',
    };
  }

  for (const origin of origins) {
    if (origin === '*') {
      return {
        ok: false,
        message:
          'CORS_ORIGINS cannot include "*" entries in production. Use full URLs like https://app.vercel.app',
      };
    }

    const isLocalhostWildcard =
      !options.production && LOCALHOST_CORS_PATTERN.test(origin);
    if (!isLocalhostWildcard && !HTTP_ORIGIN_PATTERN.test(origin)) {
      return {
        ok: false,
        message: `CORS_ORIGINS entry "${origin}" must start with http:// or https://`,
      };
    }
  }

  return { ok: true, normalized: origins.join(',') };
}

function validateProductionCorsOrigins(
  value: string,
  helpers: Joi.CustomHelpers<string>,
): string {
  const result = validateCorsOrigins(value, { production: true });
  if (!result.ok) {
    return helpers.error('any.custom', { message: result.message });
  }

  return result.normalized;
}

function validateDevelopmentCorsOrigins(
  value: string,
  helpers: Joi.CustomHelpers<string>,
): string {
  const result = validateCorsOrigins(value, { production: false });
  if (!result.ok) {
    return helpers.error('any.custom', { message: result.message });
  }

  return result.normalized;
}

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').required(),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().required(),
  CBE_ACCOUNT_NUMBER: Joi.string().required(),
  CBE_ACCOUNT_LAST8: Joi.string().length(8).required(),
  CBE_RECEIVER_NAME: Joi.string().optional(),
  TELEBIRR_RECEIVER_PHONE: Joi.string().required(),
  TELEBIRR_RECEIVER_NAME: Joi.string().optional(),
  CORS_ORIGINS: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().required().custom(validateProductionCorsOrigins),
    otherwise: Joi.string()
      .default('http://localhost:3000,http://localhost:3002,http://localhost:*')
      .custom(validateDevelopmentCorsOrigins),
  }),
  SWAGGER_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  OTP_ALLOW_MOCK: Joi.boolean().truthy('true').falsy('false').default(false),
  OTP_EXPIRES_MINUTES: Joi.number().integer().min(1).max(60).default(10),
  OTP_MAX_ATTEMPTS: Joi.number().integer().min(1).max(10).default(5),
  PAYMENT_MOCK_VERIFICATION_ALLOWED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
});

export function parseCorsOrigins(corsOrigins: string): string[] | boolean {
  const trimmed = corsOrigins.trim();
  if (trimmed === '*') {
    return true;
  }

  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
