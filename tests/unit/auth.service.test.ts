import { Pool } from 'pg';
import { AuthService, RegisterAgentResult, TokenResult } from '@modules/auth/auth.service';
import { JwtStrategy } from '@modules/auth/jwt.strategy';
import { ConflictError, UnauthorizedError, ValidationError, NotFoundError } from '@shared/middleware/error.middleware';
import * as authUtils from '@modules/auth/auth.utils';

// Mock dependencies
jest.mock('@config/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@modules/auth/jwt.strategy');
jest.mock('@modules/auth/auth.utils');

describe('AuthService', () => {
  let service: AuthService;
  let mockPool: any;
  let mockJwtStrategy: jest.Mocked<JwtStrategy>;

  beforeEach(() => {
    // Create mock pool
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn(),
      release: jest.fn(),
    };

    service = new AuthService(mockPool as Pool);
    mockJwtStrategy = (service as any).jwtStrategy as jest.Mocked<JwtStrategy>;

    // Reset all mocks
    jest.clearAllMocks();

    // Setup default mock implementations
    (authUtils.generateApiKey as jest.Mock).mockReturnValue('test-api-key');
    (authUtils.generateApiSecret as jest.Mock).mockReturnValue('test-api-secret');
    (authUtils.hashApiKey as jest.Mock).mockReturnValue('hashed-api-key');
    (authUtils.hashApiSecret as jest.Mock).mockResolvedValue('hashed-api-secret');
  });

  describe('registerAgent', () => {
    const validName = 'TestAgent';

    it('should register a new agent successfully', async () => {
      const mockResult = {
        rows: [{
          id: 'agent-123',
          name: validName,
          created_at: new Date('2024-01-01'),
        }],
        rowCount: 1,
      };

      mockPool.query.mockResolvedValue(mockResult);

      const result = await service.registerAgent(validName, 'Test description');

      expect(result).toEqual({
        id: 'agent-123',
        name: validName,
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
        createdAt: mockResult.rows[0].created_at,
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO agents'),
        expect.arrayContaining([
          expect.any(String), // id (UUID)
          validName,
          'hashed-api-key',
          'hashed-api-secret',
          expect.any(String), // metadata JSON
        ])
      );
    });

    it('should throw ValidationError for invalid name length', async () => {
      await expect(service.registerAgent('ab')).rejects.toThrow(ValidationError);
      await expect(service.registerAgent('a'.repeat(256))).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for non-string name', async () => {
      await expect(service.registerAgent('' as any)).rejects.toThrow(ValidationError);
      await expect(service.registerAgent(null as any)).rejects.toThrow(ValidationError);
    });

    it('should throw ConflictError when name already exists', async () => {
      mockPool.query.mockRejectedValue({ code: '23505' });

      await expect(service.registerAgent(validName)).rejects.toThrow(ConflictError);
    });

    it('should handle database errors', async () => {
      mockPool.query.mockRejectedValue(new Error('Database error'));

      await expect(service.registerAgent(validName)).rejects.toThrow('Database error');
    });
  });

  describe('generateTokens', () => {
    const agentId = 'agent-123';
    const timestamp = new Date().toISOString();
    const signature = 'test-signature';

    beforeEach(() => {
      (authUtils.isTimestampValid as jest.Mock).mockReturnValue(true);
      mockJwtStrategy.generateToken = jest.fn().mockReturnValue('access-token');
      mockJwtStrategy.generateRefreshToken = jest.fn().mockReturnValue('refresh-token');
    });

    it('should generate tokens successfully', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: agentId,
            api_secret_hash: 'hashed-secret',
            is_active: true,
            is_banned: false,
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // updateLastActive

      const result = await service.generateTokens(agentId, timestamp, signature, 'POST', '/auth/token', '');

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      expect(mockJwtStrategy.generateToken).toHaveBeenCalledWith(agentId);
      expect(mockJwtStrategy.generateRefreshToken).toHaveBeenCalledWith(agentId);
    });

    it('should throw UnauthorizedError for invalid timestamp', async () => {
      (authUtils.isTimestampValid as jest.Mock).mockReturnValue(false);

      await expect(
        service.generateTokens(agentId, timestamp, signature, 'POST', '/auth/token', '')
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should throw NotFoundError when agent does not exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(
        service.generateTokens(agentId, timestamp, signature, 'POST', '/auth/token', '')
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw UnauthorizedError when agent is inactive', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          id: agentId,
          api_secret_hash: 'hashed-secret',
          is_active: false,
          is_banned: false,
        }],
        rowCount: 1,
      });

      await expect(
        service.generateTokens(agentId, timestamp, signature, 'POST', '/auth/token', '')
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should throw UnauthorizedError when agent is banned', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          id: agentId,
          api_secret_hash: 'hashed-secret',
          is_active: true,
          is_banned: true,
        }],
        rowCount: 1,
      });

      await expect(
        service.generateTokens(agentId, timestamp, signature, 'POST', '/auth/token', '')
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('refreshToken', () => {
    const agentId = 'agent-123';
    const refreshToken = 'valid-refresh-token';

    beforeEach(() => {
      mockJwtStrategy.verifyRefreshToken = jest.fn().mockReturnValue({
        sub: agentId,
        type: 'refresh',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      mockJwtStrategy.generateToken = jest.fn().mockReturnValue('new-access-token');
      mockJwtStrategy.generateRefreshToken = jest.fn().mockReturnValue('new-refresh-token');
    });

    it('should refresh token successfully', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: agentId,
            is_active: true,
            is_banned: false,
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // updateLastActive

      const result = await service.refreshToken(refreshToken);

      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });
    });

    it('should throw UnauthorizedError for invalid refresh token', async () => {
      mockJwtStrategy.verifyRefreshToken = jest.fn().mockReturnValue(null);

      await expect(service.refreshToken(refreshToken)).rejects.toThrow(UnauthorizedError);
    });

    it('should throw UnauthorizedError for wrong token type', async () => {
      mockJwtStrategy.verifyRefreshToken = jest.fn().mockReturnValue({
        sub: agentId,
        type: 'access',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      await expect(service.refreshToken(refreshToken)).rejects.toThrow(UnauthorizedError);
    });

    it('should throw NotFoundError when agent does not exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(service.refreshToken(refreshToken)).rejects.toThrow(NotFoundError);
    });

    it('should throw UnauthorizedError when agent is inactive', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          id: agentId,
          is_active: false,
          is_banned: false,
        }],
        rowCount: 1,
      });

      await expect(service.refreshToken(refreshToken)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('verifyToken', () => {
    const agentId = 'agent-123';
    const token = 'valid-token';
    const exp = Math.floor(Date.now() / 1000) + 3600;

    beforeEach(() => {
      mockJwtStrategy.verifyToken = jest.fn().mockReturnValue({
        sub: agentId,
        exp,
      });
    });

    it('should verify token successfully', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          id: agentId,
          is_active: true,
          is_banned: false,
        }],
        rowCount: 1,
      });

      const result = await service.verifyToken(token);

      expect(result).toEqual({
        agentId,
        expiresAt: new Date(exp * 1000),
        isValid: true,
      });
    });

    it('should throw UnauthorizedError for invalid token', async () => {
      mockJwtStrategy.verifyToken = jest.fn().mockReturnValue(null);

      await expect(service.verifyToken(token)).rejects.toThrow(UnauthorizedError);
    });

    it('should throw NotFoundError when agent does not exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(service.verifyToken(token)).rejects.toThrow(NotFoundError);
    });

    it('should throw UnauthorizedError when agent is inactive or banned', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          id: agentId,
          is_active: false,
          is_banned: true,
        }],
        rowCount: 1,
      });

      await expect(service.verifyToken(token)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('getAgentByApiKey', () => {
    const apiKey = 'test-api-key';

    it('should return agent by API key', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          id: 'agent-123',
          api_secret_hash: 'hashed-secret',
        }],
        rowCount: 1,
      });

      const result = await service.getAgentByApiKey(apiKey);

      expect(result).toEqual({
        id: 'agent-123',
        apiSecretHash: 'hashed-secret',
      });

      expect(authUtils.hashApiKey).toHaveBeenCalledWith(apiKey);
    });

    it('should return null when agent not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await service.getAgentByApiKey(apiKey);

      expect(result).toBeNull();
    });
  });

  describe('verifyApiCredentials', () => {
    const apiKey = 'test-api-key';
    const apiSecret = 'test-api-secret';

    it('should verify API credentials successfully', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          id: 'agent-123',
          api_secret_hash: 'hashed-secret',
        }],
        rowCount: 1,
      });

      (authUtils.verifyApiSecret as jest.Mock).mockResolvedValue(true);

      const result = await service.verifyApiCredentials(apiKey, apiSecret);

      expect(result).toBe('agent-123');
      expect(authUtils.verifyApiSecret).toHaveBeenCalledWith(apiSecret, 'hashed-secret');
    });

    it('should return null when agent not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await service.verifyApiCredentials(apiKey, apiSecret);

      expect(result).toBeNull();
    });

    it('should return null when secret does not match', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          id: 'agent-123',
          api_secret_hash: 'hashed-secret',
        }],
        rowCount: 1,
      });

      (authUtils.verifyApiSecret as jest.Mock).mockResolvedValue(false);

      const result = await service.verifyApiCredentials(apiKey, apiSecret);

      expect(result).toBeNull();
    });
  });

  describe('generateTokensSimple', () => {
    const agentId = 'agent-123';

    beforeEach(() => {
      mockJwtStrategy.generateToken = jest.fn().mockReturnValue('access-token');
      mockJwtStrategy.generateRefreshToken = jest.fn().mockReturnValue('refresh-token');
    });

    it('should generate tokens using simple auth', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 1 });

      const result = await service.generateTokensSimple(agentId);

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      expect(mockJwtStrategy.generateToken).toHaveBeenCalledWith(agentId);
      expect(mockJwtStrategy.generateRefreshToken).toHaveBeenCalledWith(agentId);
    });
  });
});
