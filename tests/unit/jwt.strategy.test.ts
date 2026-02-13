import { JwtStrategy, TokenPayload } from '@modules/auth/jwt.strategy';
import jwt from 'jsonwebtoken';

describe('JwtStrategy', () => {
  let jwtStrategy: JwtStrategy;
  const testAgentId = 'test-agent-123';
  const testSecret = 'test-jwt-secret-min-32-characters-long';
  const testRefreshSecret = 'test-jwt-refresh-secret-min-32-chars';

  beforeAll(() => {
    process.env.JWT_SECRET = testSecret;
    process.env.JWT_REFRESH_SECRET = testRefreshSecret;
    process.env.JWT_EXPIRATION = '3600';
    process.env.JWT_REFRESH_EXPIRATION = '604800';
  });

  beforeEach(() => {
    jwtStrategy = new JwtStrategy();
  });

  describe('generateToken', () => {
    it('should generate a valid access token', () => {
      const token = jwtStrategy.generateToken(testAgentId);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      // Verify token structure
      const decoded = jwt.verify(token, testSecret) as TokenPayload;
      expect(decoded.sub).toBe(testAgentId);
      expect(decoded.type).toBe('access');
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
    });

    it('should generate token with custom expiration', () => {
      const customExpiration = 7200;
      const token = jwtStrategy.generateToken(testAgentId, customExpiration);

      const decoded = jwt.verify(token, testSecret) as TokenPayload;
      const expectedExpiration = decoded.iat! + customExpiration;
      expect(decoded.exp).toBe(expectedExpiration);
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a valid refresh token', () => {
      const token = jwtStrategy.generateRefreshToken(testAgentId);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const decoded = jwt.verify(token, testRefreshSecret) as TokenPayload;
      expect(decoded.sub).toBe(testAgentId);
      expect(decoded.type).toBe('refresh');
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid access token', () => {
      const token = jwtStrategy.generateToken(testAgentId);
      const decoded = jwtStrategy.verifyToken(token);

      expect(decoded).not.toBeNull();
      expect(decoded?.sub).toBe(testAgentId);
      expect(decoded?.type).toBe('access');
    });

    it('should return null for invalid token', () => {
      const decoded = jwtStrategy.verifyToken('invalid-token');
      expect(decoded).toBeNull();
    });

    it('should return null for expired token', () => {
      const expiredToken = jwt.sign(
        { sub: testAgentId, type: 'access' },
        testSecret,
        { expiresIn: -1 }
      );

      const decoded = jwtStrategy.verifyToken(expiredToken);
      expect(decoded).toBeNull();
    });

    it('should return null for token with wrong secret', () => {
      const token = jwt.sign(
        { sub: testAgentId, type: 'access' },
        'wrong-secret',
        { expiresIn: 3600 }
      );

      const decoded = jwtStrategy.verifyToken(token);
      expect(decoded).toBeNull();
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify a valid refresh token', () => {
      const token = jwtStrategy.generateRefreshToken(testAgentId);
      const decoded = jwtStrategy.verifyRefreshToken(token);

      expect(decoded).not.toBeNull();
      expect(decoded?.sub).toBe(testAgentId);
      expect(decoded?.type).toBe('refresh');
    });

    it('should return null for invalid refresh token', () => {
      const decoded = jwtStrategy.verifyRefreshToken('invalid-token');
      expect(decoded).toBeNull();
    });
  });

  describe('decodeToken', () => {
    it('should decode token without verification', () => {
      const token = jwtStrategy.generateToken(testAgentId);
      const decoded = jwtStrategy.decodeToken(token);

      expect(decoded).not.toBeNull();
      expect(decoded?.sub).toBe(testAgentId);
      expect(decoded?.type).toBe('access');
    });

    it('should decode even expired token', () => {
      const expiredToken = jwt.sign(
        { sub: testAgentId, type: 'access' },
        testSecret,
        { expiresIn: -1 }
      );

      const decoded = jwtStrategy.decodeToken(expiredToken);
      expect(decoded).not.toBeNull();
      expect(decoded?.sub).toBe(testAgentId);
    });
  });
});
