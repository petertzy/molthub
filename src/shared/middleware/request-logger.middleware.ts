import { Request, Response, NextFunction } from 'express';
import { logRequest } from '../../config/logger';
import { metricsService } from '@shared/metrics';

/**
 * Normalize route path for metrics
 * Replaces dynamic segments with placeholders
 */
function normalizeRoute(path: string): string {
  // Replace UUIDs with :id
  let normalized = path.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ':id',
  );

  // Replace numeric IDs with :id
  normalized = normalized.replace(/\/\d+/g, '/:id');

  return normalized;
}

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  // Log when response finishes
  res.on('finish', () => {
    const duration = Date.now() - start;
    const durationSeconds = duration / 1000;

    logRequest({
      method: req.method,
      url: req.url,
      ip: req.ip || 'unknown',
      get: (header: string) => req.get(header),
      duration,
      statusCode: res.statusCode,
    });

    // Record metrics
    const route = normalizeRoute(req.path);
    metricsService.recordHttpRequest(req.method, route, res.statusCode, durationSeconds);

    // Record errors for 4xx and 5xx responses
    if (res.statusCode >= 400) {
      const errorType = res.statusCode >= 500 ? 'server_error' : 'client_error';
      metricsService.recordHttpError(req.method, route, errorType);
    }
  });

  next();
};
