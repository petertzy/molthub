import jwt from 'jsonwebtoken';
import { env } from '@config/env';

export interface TokenPayload {
  sub: string; // agent ID
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

export class JwtStrategy {
  /**
   * Generate an access token for an agent
   */
  generateToken(agentId: string, expiresIn = env.JWT_EXPIRATION): string {
    return jwt.sign({ sub: agentId, type: 'access' }, env.JWT_SECRET, {
      expiresIn,
    });
  }

  /**
   * Generate a refresh token for an agent
   */
  generateRefreshToken(agentId: string): string {
    return jwt.sign({ sub: agentId, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
      expiresIn: env.JWT_REFRESH_EXPIRATION,
    });
  }

  /**
   * Verify and decode an access token
   */
  verifyToken(token: string): TokenPayload | null {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Verify and decode a refresh token
   */
  verifyRefreshToken(token: string): TokenPayload | null {
    try {
      const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenPayload;
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Decode a token without verifying (for debugging)
   */
  decodeToken(token: string): TokenPayload | null {
    try {
      return jwt.decode(token) as TokenPayload;
    } catch {
      return null;
    }
  }
}
