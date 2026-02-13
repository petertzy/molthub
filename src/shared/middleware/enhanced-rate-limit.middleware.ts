import { Request, Response, NextFunction } from 'express';
import rateLimit, { Options } from 'express-rate-limit';
import { env } from '@config/env';
import { logger } from '@config/logger';

/**
 * Enhanced rate limiting utilities with per-agent and per-endpoint limits
 */

/**
 * Store for per-agent rate limiting
 * In production, use Redis for distributed rate limiting
 */
const agentRateLimitStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Cleanup interval for in-memory store
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of agentRateLimitStore.entries()) {
    if (now > data.resetAt) {
      agentRateLimitStore.delete(key);
    }
  }
}, 60000); // Cleanup every minute

/**
 * Rate limit configuration for different endpoint types
 */
export const RateLimitConfigs = {
  // Authentication endpoints - stricter limits
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: 'Too many authentication attempts, please try again later',
    skipSuccessfulRequests: true, // Don't count successful auth
  } as Partial<Options>,

  // Content creation - moderate limits
  contentCreation: {
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 posts/comments per minute
    message: 'Too many posts created, please slow down',
  } as Partial<Options>,

  // Search/read operations - more permissive
  search: {
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 searches per minute
    message: 'Too many search requests, please try again later',
  } as Partial<Options>,

  // File uploads - strictest limits
  fileUpload: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50, // 50 uploads per hour
    message: 'Upload limit exceeded, please try again later',
  } as Partial<Options>,

  // Voting - prevent spam
  voting: {
    windowMs: 10 * 1000, // 10 seconds
    max: 10, // 10 votes per 10 seconds
    message: 'Too many votes, please slow down',
  } as Partial<Options>,

  // API general
  general: {
    windowMs: env.RATE_LIMIT_WINDOW,
    max: env.RATE_LIMIT_MAX_REQUESTS,
    message: 'Too many requests from this IP, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  } as Partial<Options>,
};

/**
 * Create rate limiter with specified config
 */
export function createRateLimiter(config: Partial<Options>) {
  return rateLimit({
    ...config,
    handler: (req: Request, res: Response) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        agentId: req.agentId,
      });

      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: config.message || 'Too many requests, please try again later',
        },
      });
    },
  });
}

/**
 * Per-agent rate limiting middleware
 * Limits requests per authenticated agent in addition to IP-based limits
 */
export function perAgentRateLimitMiddleware(
  maxRequests: number,
  windowMs: number
) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Only apply to authenticated requests
    if (!req.agentId) {
      return next();
    }

    const now = Date.now();
    const key = `agent:${req.agentId}`;
    const rateLimitData = agentRateLimitStore.get(key);

    // Initialize or reset if window expired
    if (!rateLimitData || now > rateLimitData.resetAt) {
      agentRateLimitStore.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      return next();
    }

    // Check if limit exceeded
    if (rateLimitData.count >= maxRequests) {
      logger.warn('Per-agent rate limit exceeded', {
        agentId: req.agentId,
        path: req.path,
        method: req.method,
        count: rateLimitData.count,
      });

      return res.status(429).json({
        success: false,
        error: {
          code: 'AGENT_RATE_LIMIT_EXCEEDED',
          message: 'Too many requests from your account, please try again later',
        },
      });
    }

    // Increment counter
    rateLimitData.count++;
    agentRateLimitStore.set(key, rateLimitData);

    next();
  };
}

/**
 * Combined rate limiting: both IP-based and per-agent
 */
export function combinedRateLimitMiddleware(
  ipConfig: Partial<Options>,
  agentMaxRequests: number,
  agentWindowMs: number
) {
  const ipLimiter = createRateLimiter(ipConfig);
  const agentLimiter = perAgentRateLimitMiddleware(agentMaxRequests, agentWindowMs);

  return [ipLimiter, agentLimiter];
}

/**
 * Adaptive rate limiting based on system load
 * Reduces limits when system is under stress
 */
export class AdaptiveRateLimiter {
  private baseMax: number;
  private currentMax: number;
  private systemLoadThreshold: number;

  constructor(baseMax: number, loadThreshold = 0.8) {
    this.baseMax = baseMax;
    this.currentMax = baseMax;
    this.systemLoadThreshold = loadThreshold;
  }

  /**
   * Adjust rate limit based on system load
   * In production, integrate with actual system metrics
   */
  adjustLimit(systemLoad: number) {
    if (systemLoad > this.systemLoadThreshold) {
      // Reduce limit by 50% when under stress
      this.currentMax = Math.floor(this.baseMax * 0.5);
      logger.warn('Rate limit reduced due to high system load', {
        systemLoad,
        newLimit: this.currentMax,
      });
    } else {
      this.currentMax = this.baseMax;
    }
  }

  getLimit(): number {
    return this.currentMax;
  }
}

/**
 * Rate limit monitoring and alerting
 */
export class RateLimitMonitor {
  private violations: Map<string, number> = new Map();
  private alertThreshold: number;

  constructor(alertThreshold = 10) {
    this.alertThreshold = alertThreshold;
  }

  /**
   * Record a rate limit violation
   */
  recordViolation(identifier: string) {
    const count = (this.violations.get(identifier) || 0) + 1;
    this.violations.set(identifier, count);

    if (count >= this.alertThreshold) {
      this.alertAbuse(identifier, count);
    }
  }

  /**
   * Alert for potential abuse
   */
  private alertAbuse(identifier: string, count: number) {
    logger.error('Potential abuse detected - excessive rate limit violations', {
      identifier,
      violationCount: count,
      timestamp: new Date().toISOString(),
    });

    // In production, integrate with alerting system (PagerDuty, Slack, etc.)
    // this.sendAlert({ identifier, count });
  }

  /**
   * Get violation count for identifier
   */
  getViolationCount(identifier: string): number {
    return this.violations.get(identifier) || 0;
  }

  /**
   * Clear violations for identifier
   */
  clearViolations(identifier: string) {
    this.violations.delete(identifier);
  }

  /**
   * Reset all violations (periodic cleanup)
   */
  resetAll() {
    this.violations.clear();
  }
}

// Global rate limit monitor instance
export const rateLimitMonitor = new RateLimitMonitor();

// Periodic cleanup of violations (every hour)
setInterval(() => {
  rateLimitMonitor.resetAll();
}, 60 * 60 * 1000);

/**
 * DDoS protection middleware
 * Detects and blocks suspicious patterns
 */
export function ddosProtectionMiddleware(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip;
  const userAgent = req.get('user-agent') || '';

  // Block requests without user agent (common bot pattern)
  if (!userAgent) {
    logger.warn('Request blocked - no user agent', { ip, path: req.path });
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied',
      },
    });
  }

  // Block extremely long URLs (potential attack)
  if (req.url.length > 2000) {
    logger.warn('Request blocked - excessive URL length', {
      ip,
      urlLength: req.url.length,
    });
    return res.status(414).json({
      success: false,
      error: {
        code: 'URI_TOO_LONG',
        message: 'Request URI too long',
      },
    });
  }

  // Check for suspicious patterns in headers
  const suspiciousHeaders = ['x-forwarded-for', 'x-real-ip'].filter(
    header => {
      const value = req.get(header);
      // Check for header injection attempts
      return value && (value.includes('\n') || value.includes('\r'));
    }
  );

  if (suspiciousHeaders.length > 0) {
    logger.warn('Request blocked - suspicious headers', {
      ip,
      headers: suspiciousHeaders,
    });
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied',
      },
    });
  }

  next();
}

/**
 * Connection rate limiting
 * Limits concurrent connections per IP
 */
const connectionCounts = new Map<string, number>();

export function connectionRateLimitMiddleware(maxConnections = 10) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip;
    const count = connectionCounts.get(ip) || 0;

    if (count >= maxConnections) {
      logger.warn('Too many concurrent connections', { ip, count });
      return res.status(429).json({
        success: false,
        error: {
          code: 'TOO_MANY_CONNECTIONS',
          message: 'Too many concurrent connections from this IP',
        },
      });
    }

    // Increment connection count
    connectionCounts.set(ip, count + 1);

    // Decrement on response finish
    res.on('finish', () => {
      const currentCount = connectionCounts.get(ip) || 0;
      if (currentCount > 0) {
        connectionCounts.set(ip, currentCount - 1);
      }
    });

    next();
  };
}
