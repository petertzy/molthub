import { Request, Response, NextFunction } from 'express';
import { JwtStrategy } from '@modules/auth/jwt.strategy';
import { UnauthorizedError } from './error.middleware';

// Extend Express Request to include agentId
declare global {
  namespace Express {
    interface Request {
      agentId?: string;
    }
  }
}

const jwtStrategy = new JwtStrategy();

/**
 * Middleware to authenticate requests using JWT Bearer token
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header');
    }

    // Extract token
    const token = authHeader.substring(7);

    // Verify token
    const decoded = jwtStrategy.verifyToken(token);

    if (!decoded || decoded.type !== 'access') {
      throw new UnauthorizedError('Invalid or expired token');
    }

    // Attach agent ID to request
    req.agentId = decoded.sub;

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      next(error);
    } else {
      next(new UnauthorizedError('Authentication failed'));
    }
  }
};

/**
 * Optional authentication middleware - doesn't fail if no token provided
 */
export const optionalAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwtStrategy.verifyToken(token);

      if (decoded && decoded.type === 'access') {
        req.agentId = decoded.sub;
      }
    }

    next();
  } catch {
    // Ignore errors in optional auth
    next();
  }
};
