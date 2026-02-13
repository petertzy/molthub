import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { ForbiddenError } from './error.middleware';

/**
 * CSRF Token Store
 * In production, consider using Redis for distributed environments
 */
const tokenStore = new Map<string, { token: string; createdAt: number }>();

// Token expiration time (30 minutes)
const TOKEN_EXPIRATION = 30 * 60 * 1000;

// Cleanup interval (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;

/**
 * Generate a cryptographically secure CSRF token
 */
export function generateCsrfToken(sessionId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  tokenStore.set(sessionId, {
    token,
    createdAt: Date.now(),
  });
  return token;
}

/**
 * Verify CSRF token
 */
export function verifyCsrfToken(sessionId: string, token: string): boolean {
  const stored = tokenStore.get(sessionId);
  
  if (!stored) {
    return false;
  }

  // Check if token has expired
  if (Date.now() - stored.createdAt > TOKEN_EXPIRATION) {
    tokenStore.delete(sessionId);
    return false;
  }

  // Use timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(stored.token),
    Buffer.from(token)
  );
}

/**
 * Clean up expired tokens periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, data] of tokenStore.entries()) {
    if (now - data.createdAt > TOKEN_EXPIRATION) {
      tokenStore.delete(sessionId);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Middleware to generate and provide CSRF token
 * Use this on GET endpoints that return forms or pages that need CSRF protection
 */
export const csrfTokenMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Use agent ID as session identifier if authenticated, otherwise use IP + User-Agent
  const sessionId = req.agentId || `${req.ip}-${req.get('user-agent')}`;
  
  // Generate or retrieve existing token
  let storedToken = tokenStore.get(sessionId);
  
  if (!storedToken || Date.now() - storedToken.createdAt > TOKEN_EXPIRATION) {
    const token = generateCsrfToken(sessionId);
    storedToken = tokenStore.get(sessionId)!;
  }

  // Add token to response locals for template rendering
  res.locals.csrfToken = storedToken.token;
  
  // Also add to response header for SPA/API usage
  res.setHeader('X-CSRF-Token', storedToken.token);
  
  next();
};

/**
 * Middleware to verify CSRF token on state-changing operations
 * Use this on POST, PUT, PATCH, DELETE endpoints
 */
export const csrfProtectionMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Skip CSRF check for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Get session identifier
  const sessionId = req.agentId || `${req.ip}-${req.get('user-agent')}`;

  // Get token from header or body
  const token = req.get('X-CSRF-Token') || req.body?._csrf || req.query._csrf;

  if (!token) {
    throw new ForbiddenError('CSRF token missing');
  }

  if (!verifyCsrfToken(sessionId, token as string)) {
    throw new ForbiddenError('Invalid or expired CSRF token');
  }

  next();
};

/**
 * Optional CSRF protection - doesn't fail if no token provided
 * Useful for APIs that support both CSRF-protected and non-CSRF clients
 */
export const optionalCsrfMiddleware = (req: Request, res: Response, next: NextFunction) => {
  try {
    csrfProtectionMiddleware(req, res, next);
  } catch (error) {
    // Log but don't fail
    next();
  }
};

/**
 * Get CSRF token for current session
 * Helper function for controllers
 */
export function getCsrfToken(req: Request): string {
  const sessionId = req.agentId || `${req.ip}-${req.get('user-agent')}`;
  return generateCsrfToken(sessionId);
}
