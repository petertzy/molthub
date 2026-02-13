import winston from 'winston';
import { env, isDev, isProd } from './env';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
};

winston.addColors(colors);

const format =
  env.LOG_FORMAT === 'json'
    ? winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      )
    : winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.colorize({ all: true }),
        winston.format.printf(
          (info) =>
            `${info.timestamp} [${info.level}]: ${info.message}${info.stack ? '\n' + info.stack : ''}`,
        ),
      );

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: isDev
      ? winston.format.combine(
          winston.format.colorize({ all: true }),
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          winston.format.printf((info) => `${info.timestamp} [${info.level}]: ${info.message}`),
        )
      : format,
  }),
];

if (isProd) {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.json(),
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: winston.format.json(),
    }),
  );
}

// Add Logstash transport if configured
if (env.LOGSTASH_ENABLED) {
  try {
    // Dynamic import to avoid issues if winston-logstash is not installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const LogstashTransport = require('winston-logstash/lib/winston-logstash-latest');
    
    transports.push(
      new LogstashTransport({
        port: env.LOGSTASH_PORT || 5000,
        host: env.LOGSTASH_HOST || 'localhost',
        max_connect_retries: 3,
        timeout_connect_retries: 5000,
      }),
    );
    console.log('Logstash transport enabled');
  } catch (error) {
    console.warn('Logstash transport not available:', (error as Error).message);
  }
}

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  levels,
  format,
  transports,
  exitOnError: false,
});

// Add request logging helper
export const logRequest = (req: {
  method: string;
  url: string;
  ip: string;
  get: (header: string) => string | undefined;
  duration?: number;
  statusCode?: number;
}) => {
  logger.info('Incoming request', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
};

// Add error logging helper
export const logError = (error: Error, context?: Record<string, unknown>) => {
  logger.error(error.message, {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    ...context,
  });
};
