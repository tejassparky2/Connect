import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  // No default on purpose: an unset NODE_ENV must not silently enable dev OTP/payments.
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('*'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  OTP_PROVIDER: z.enum(['dev', 'supabase']).default('dev'),
  OTP_SECRET: z.string().min(16).default('dev-otp-hmac-secret-change-me'),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_ANON_KEY: z.string().optional().default(''),
  /** Preferred: an sb_secret_… key (required for Sb-Forwarded-For per-user rate limiting). */
  SUPABASE_SECRET_KEY: z.string().optional().default(''),
  UPLOAD_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  S3_BUCKET: z.string().optional().default(''),
  S3_REGION: z.string().optional().default('ap-south-1'),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  S3_PUBLIC_URL: z.string().optional().default(''),
  RAZORPAY_KEY_ID: z.string().optional().default(''),
  RAZORPAY_KEY_SECRET: z.string().optional().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),
  EXPO_ACCESS_TOKEN: z.string().optional().default(''),
  PUSH_ENABLED: bool,
  /** Passing GPS checks needed to reach LOCATION level, and the min gap between them. */
  GPS_CHECKS_REQUIRED: z.coerce.number().int().min(1).max(5).default(2),
  GPS_CHECK_MIN_GAP_HOURS: z.coerce.number().min(0).default(6),
  /** Max metres between claimed home pin and on-device GPS fix. */
  GPS_MAX_DISTANCE_M: z.coerce.number().positive().default(200),
  GPS_MAX_ACCURACY_M: z.coerce.number().positive().default(150),
  VOUCHES_REQUIRED: z.coerce.number().int().min(1).default(2),
  /** Number of reverse-proxy hops in front of the API (0 = none). Wrong values let clients spoof IPs via X-Forwarded-For. */
  TRUST_PROXY: z.string().default('0'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:\n', parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

// Production safety rails — refuse to boot with insecure settings.
if (isProd) {
  const problems: string[] = [];
  if (env.OTP_PROVIDER === 'dev') problems.push('OTP_PROVIDER=dev is not allowed in production');
  if (env.CORS_ORIGINS.trim() === '*') problems.push('CORS_ORIGINS must be an explicit allow-list in production');
  if (/change-me/i.test(env.JWT_ACCESS_SECRET + env.JWT_REFRESH_SECRET + env.OTP_SECRET))
    problems.push('JWT/OTP secrets still contain placeholder values');
  if (env.OTP_PROVIDER === 'supabase' && (!env.SUPABASE_URL || !(env.SUPABASE_SECRET_KEY || env.SUPABASE_ANON_KEY)))
    problems.push('SUPABASE_URL and SUPABASE_SECRET_KEY are required when OTP_PROVIDER=supabase');
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error('❌ Refusing to start:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
}
