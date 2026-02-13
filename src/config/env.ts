import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_VERSION: z.string().default('v1'),
  DATABASE_URL: z.string().default('postgresql://user:password@localhost:5432/moltbook'),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  DATABASE_POOL_MAX: z.coerce.number().default(10),
  REDIS_URL: z.string().default('redis://localhost:6379/0'),
  REDIS_CACHE_TTL: z.coerce.number().default(3600),
  JWT_SECRET: z.string().min(32).default('change-this-secret-in-production-min-32-chars'),
  JWT_REFRESH_SECRET: z.string().min(32).default('change-this-refresh-secret-in-production-32'),
  JWT_EXPIRATION: z.coerce.number().default(3600),
  JWT_REFRESH_EXPIRATION: z.coerce.number().default(604800),
  // Audit logging
  AUDIT_ENCRYPTION_KEY: z.string().min(32).optional(),
  AUDIT_RETENTION_DAYS: z.coerce.number().default(365),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['json', 'simple']).default('json'),
  // Logstash configuration
  LOGSTASH_ENABLED: z.coerce.boolean().default(false),
  LOGSTASH_HOST: z.string().default('localhost'),
  LOGSTASH_PORT: z.coerce.number().default(5000),
  // Sentry configuration
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().default(0.1),
  SENTRY_PROFILES_SAMPLE_RATE: z.coerce.number().default(0.1),
  RATE_LIMIT_WINDOW: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  // Vector Database (Pinecone)
  PINECONE_API_KEY: z.string().optional(),
  PINECONE_ENVIRONMENT: z.string().optional(),
  PINECONE_INDEX: z.string().default('moltbook-agents'),
  // OpenAI for embeddings
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  // Memory configuration
  MEMORY_EXPIRATION_DAYS: z.coerce.number().default(90),
  MEMORY_MIN_HEAT_SCORE: z.coerce.number().default(0.1),
  MEMORY_CLEANUP_BATCH_SIZE: z.coerce.number().default(100),
  // File Storage configuration
  STORAGE_TYPE: z.enum(['local', 's3', 'minio']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./uploads'),
  // S3/MinIO configuration
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().optional(), // For MinIO
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false), // For MinIO
  // File upload limits
  MAX_FILE_SIZE: z.coerce.number().default(52428800), // 50MB in bytes
  MAX_FILES_PER_UPLOAD: z.coerce.number().default(5),
  ALLOWED_FILE_TYPES: z
    .string()
    .default('image/jpeg,image/png,image/gif,image/webp,application/pdf'),
  // Thumbnail configuration
  THUMBNAIL_WIDTH: z.coerce.number().default(300),
  THUMBNAIL_HEIGHT: z.coerce.number().default(300),
  THUMBNAIL_QUALITY: z.coerce.number().default(80),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);

export const isDev = env.NODE_ENV === 'development';
export const isProd = env.NODE_ENV === 'production';
export const isStaging = env.NODE_ENV === 'staging';
