import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .required(),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),
  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().required(),
  CBE_ACCOUNT_NUMBER: Joi.string().required(),
  CBE_ACCOUNT_LAST8: Joi.string().length(8).required(),
  CBE_RECEIVER_NAME: Joi.string().optional(),
  TELEBIRR_RECEIVER_PHONE: Joi.string().required(),
  TELEBIRR_RECEIVER_NAME: Joi.string().optional(),
  CORS_ORIGINS: Joi.string().default('*'),
  SWAGGER_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
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
