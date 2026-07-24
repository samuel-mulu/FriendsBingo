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
    if (options.production) {
      return {
        ok: false,
        message:
          'CORS_ORIGINS cannot be "*" in production. Set your browser frontend URL(s), e.g. https://friends-bingo-admin.vercel.app (Flutter mobile apps do not need to be listed).',
      };
    }

    return { ok: true, normalized: '*' };
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
      if (options.production) {
        return {
          ok: false,
          message:
            'CORS_ORIGINS cannot include "*" entries in production. Use full URLs like https://app.vercel.app',
        };
      }

      continue;
    }

    if (options.production && origin.includes('*')) {
      return {
        ok: false,
        message: `CORS_ORIGINS entry "${origin}" cannot use wildcards in production. Use a full URL like https://app.vercel.app`,
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
): string | Joi.ErrorReport {
  const result = validateCorsOrigins(value, { production: true });
  if (!result.ok) {
    return helpers.error('any.custom', { message: result.message });
  }

  return result.normalized;
}

function validateDevelopmentCorsOrigins(
  value: string,
  helpers: Joi.CustomHelpers<string>,
): string | Joi.ErrorReport {
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
  DIRECT_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .optional(),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).max(100).default(15),
  DATABASE_DIRECT_POOL_MAX: Joi.number().integer().min(1).max(50).default(5),
  FIREBASE_PROJECT_ID: Joi.string().required(),
  FIREBASE_CLIENT_EMAIL: Joi.string().email().required(),
  FIREBASE_PRIVATE_KEY: Joi.string().min(1).required(),
  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().required(),
  REFRESH_TOKEN_EXPIRES_DAYS: Joi.number().integer().min(1).default(90),
  GAME_DETAIL_RETENTION_DAYS: Joi.number().integer().min(0).default(90),
  CBE_SETTLEMENT_ACCOUNT: Joi.string().required(),
  CBE_ACCOUNT_SUFFIX: Joi.string()
    .pattern(/^\d{8}$/)
    .optional(),
  CBE_ACCOUNT_LAST8: Joi.string()
    .pattern(/^\d{8}$/)
    .optional(),
  CBE_PROVIDER_NAME: Joi.string().default('CBE Bank'),
  CBE_RECEIVER_NAME: Joi.string().optional(),
  AWASH_SETTLEMENT_ACCOUNT: Joi.string().required(),
  AWASH_PROVIDER_NAME: Joi.string().default('Awash Bank'),
  AWASH_RECEIVER_NAME: Joi.string().optional(),
  BOA_SETTLEMENT_ACCOUNT: Joi.string().required(),
  BOA_ACCOUNT_SUFFIX: Joi.string()
    .pattern(/^\d{5,}$/)
    .optional()
    .messages({
      'string.pattern.base':
        'BOA_ACCOUNT_SUFFIX must be at least 5 digits (Verify.ET uses the last 5)',
    }),
  BOA_PROVIDER_NAME: Joi.string().default('Bank of Abyssinia'),
  BOA_RECEIVER_NAME: Joi.string().optional(),
  TELEBIRR_RECEIVER_PHONE: Joi.string().required(),
  TELEBIRR_RECEIVER_PHONE_LAST4: Joi.string().length(4).optional(),
  TELEBIRR_RECEIVER_NAME: Joi.string().optional(),
  TELEBIRR_RECEIPT_BASE_URL: Joi.string()
    .uri({ scheme: ['https'] })
    .default('https://transactioninfo.ethiotelecom.et/receipt'),
  TELEBIRR_SETTLEMENT_ACCOUNT: Joi.string().required(),
  TELEBIRR_SETTLEMENT_ACCOUNT_2: Joi.string().optional(),
  TELEBIRR_RECEIVER_PHONE_2: Joi.string().optional(),
  TELEBIRR_RECEIVER_NAME_2: Joi.string().optional(),
  TELEBIRR_RECEIVER_PHONE_LAST4_2: Joi.string().length(4).optional(),
  TELEBIRR_PROVIDER_NAME: Joi.string().default('Telebirr'),
  VERIFY_ET_API_KEY: Joi.string().required(),
  VERIFY_ET_BASE_URL: Joi.string()
    .uri({ scheme: ['https'] })
    .default('https://verify.et'),
  VERIFY_ET_WAIT_MS: Joi.number().integer().min(0).default(5000),
  VERIFY_ET_POLL_ATTEMPTS: Joi.number()
    .integer()
    .min(1)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.number().integer().min(1).default(10),
      otherwise: Joi.number().integer().min(1).default(20),
    }),
  VERIFY_ET_POLL_INTERVAL_MS: Joi.number().integer().min(100).default(1500),
  CORS_ORIGINS: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .required()
      .custom(validateProductionCorsOrigins)
      .messages({ 'any.custom': '{{#message}}' }),
    otherwise: Joi.string()
      .default('*')
      .custom(validateDevelopmentCorsOrigins)
      .messages({ 'any.custom': '{{#message}}' }),
  }),
  SWAGGER_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  OTP_EXPIRES_MINUTES: Joi.number().integer().min(1).max(60).default(5),
  OTP_MAX_ATTEMPTS: Joi.number().integer().min(1).max(20).default(8),
  OTP_RESEND_COOLDOWN_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(300)
    .default(30),
  OTP_SEND_LIMIT_PER_PHONE: Joi.number().integer().min(1).max(100).default(30),
  OTP_SEND_LIMIT_PER_IP: Joi.number().integer().min(1).max(500).default(200),
  OTP_SEND_WINDOW_MINUTES: Joi.number().integer().min(1).max(60).default(15),
  GEEZSMS_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  PUSH_NOTIFICATIONS_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(true),
  GEEZSMS_BASE_URL: Joi.string()
    .uri()
    .default('https://api.geezsms.com/api/v1'),
  GEEZSMS_TOKEN: Joi.when('GEEZSMS_ENABLED', {
    is: true,
    then: Joi.string().min(1).required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  GEEZSMS_SHORTCODE_ID: Joi.string().allow('').default(''),
  GEEZSMS_CALLBACK_URL: Joi.string().uri().allow('').default(''),
  GEEZSMS_TIMEOUT_MS: Joi.number()
    .integer()
    .min(5000)
    .max(120000)
    .default(30000),
  WITHDRAWAL_ADMIN_SMS_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  ADMIN_SMS_PHONES: Joi.string().allow('').default(''),
  ADMIN_DASHBOARD_URL: Joi.string().uri().allow('').default(''),
  PAYMENT_MOCK_VERIFICATION_ALLOWED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  ANDROID_LATEST_VERSION: Joi.string().default('1.0.1'),
  ANDROID_LATEST_VERSION_CODE: Joi.number().integer().min(1).default(2),
  ANDROID_MINIMUM_VERSION_CODE: Joi.number().integer().min(1).default(1),
  ANDROID_APK_DOWNLOAD_URL: Joi.string().uri().allow('').default(''),
  ANDROID_APK_SHA256: Joi.string()
    .pattern(/^[a-f0-9]{64}$/i)
    .allow('')
    .default(''),
  ANDROID_RELEASE_NOTES: Joi.string().allow('').default(''),
  ANDROID_FORCE_UPDATE: Joi.boolean()
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
