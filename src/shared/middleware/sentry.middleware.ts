import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import * as Sentry from '@sentry/node';
import { env } from '@config/env';

/**
 * Middleware to add Sentry request handler
 */
export function sentryRequestHandler() {
  if (!env.SENTRY_DSN) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  
  return Sentry.Handlers.requestHandler();
}

/**
 * Middleware to add Sentry tracing handler
 */
export function sentryTracingHandler() {
  if (!env.SENTRY_DSN) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  
  return Sentry.Handlers.tracingHandler();
}

/**
 * Middleware to add Sentry error handler
 * Should be added after all routes but before application error handler
 * This captures errors for Sentry without interfering with error response formatting
 */
export function sentryErrorHandler(): ErrorRequestHandler {
  if (!env.SENTRY_DSN) {
    // Pass error to next handler when Sentry is disabled
    return (err: Error, _req: Request, _res: Response, next: NextFunction) => next(err);
  }
  
  return Sentry.Handlers.errorHandler({
    shouldHandleError(error) {
      // Capture all errors with status code >= 500
      const statusCode = (error as any).statusCode || (error as any).status;
      return !statusCode || statusCode >= 500;
    },
  }) as ErrorRequestHandler;
}
