import * as Sentry from '@sentry/node';
import { ProfilingIntegration } from '@sentry/profiling-node';
import { env, isProd, isStaging } from '@config/env';
import { logger } from '@config/logger';

/**
 * Initialize Sentry for error tracking and performance monitoring
 */
export function initializeSentry(): void {
  if (!env.SENTRY_DSN) {
    logger.info('Sentry DSN not configured, skipping Sentry initialization');
    return;
  }

  try {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV,
      
      // Performance Monitoring
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
      profilesSampleRate: env.SENTRY_PROFILES_SAMPLE_RATE,
      
      // Integrations
      integrations: [
        // Enable HTTP calls tracing
        new Sentry.Integrations.Http({ tracing: true }),
        // Enable Express tracing
        new Sentry.Integrations.Express({ app: undefined }),
        // Enable profiling
        new ProfilingIntegration(),
      ],
      
      // Release tracking
      release: process.env.npm_package_version,
      
      // Before send hook to filter sensitive data
      beforeSend(event, hint) {
        // Filter out sensitive information
        if (event.request) {
          // Remove authorization headers
          if (event.request.headers) {
            delete event.request.headers.authorization;
            delete event.request.headers.cookie;
          }
          
          // Remove sensitive query parameters
          if (event.request.query_string && typeof event.request.query_string === 'string') {
            event.request.query_string = event.request.query_string.replace(
              /(api_key|token|password|secret)=[^&]*/gi,
              '$1=***REDACTED***',
            );
          }
        }
        
        // Filter out environment variables - skip for now due to type complexity
        // Sentry automatically redacts many sensitive env vars
        
        return event;
      },
      
      // Only capture errors in production and staging
      enabled: isProd || isStaging,
    });
    
    logger.info('Sentry initialized successfully', {
      environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    });
  } catch (error) {
    logger.error('Failed to initialize Sentry', { error });
  }
}

/**
 * Capture an exception with Sentry
 */
export function captureException(error: Error, context?: Record<string, unknown>): void {
  if (!env.SENTRY_DSN) {
    return;
  }
  
  Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Capture a message with Sentry
 */
export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info'): void {
  if (!env.SENTRY_DSN) {
    return;
  }
  
  Sentry.captureMessage(message, level);
}

/**
 * Set user context for Sentry
 */
export function setUserContext(user: { id: string; email?: string; username?: string }): void {
  if (!env.SENTRY_DSN) {
    return;
  }
  
  Sentry.setUser(user);
}

/**
 * Clear user context
 */
export function clearUserContext(): void {
  if (!env.SENTRY_DSN) {
    return;
  }
  
  Sentry.setUser(null);
}

/**
 * Add breadcrumb for context
 */
export function addBreadcrumb(
  message: string,
  category: string,
  level: Sentry.SeverityLevel = 'info',
  data?: Record<string, unknown>,
): void {
  if (!env.SENTRY_DSN) {
    return;
  }
  
  Sentry.addBreadcrumb({
    message,
    category,
    level,
    data,
  });
}

export { Sentry };
