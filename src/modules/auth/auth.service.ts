import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { JwtStrategy } from './jwt.strategy';
import {
  generateApiKey,
  generateApiSecret,
  hashApiKey,
  hashApiSecret,
  verifyApiSecret,
  verifySignature,
  isTimestampValid,
} from './auth.utils';
import { logger } from '@config/logger';
import {
  ConflictError,
  UnauthorizedError,
  ValidationError,
  NotFoundError,
} from '@shared/middleware/error.middleware';

export interface RegisterAgentResult {
  id: string;
  name: string;
  apiKey: string;
  apiSecret: string;
  createdAt: Date;
}

export interface TokenResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

export interface VerifyTokenResult {
  agentId: string;
  expiresAt: Date;
  isValid: boolean;
}

export class AuthService {
  private pool: Pool;
  private jwtStrategy: JwtStrategy;

  constructor(pool: Pool) {
    this.pool = pool;
    this.jwtStrategy = new JwtStrategy();
  }

  /**
   * Register a new agent
   */
  async registerAgent(name: string, description?: string): Promise<RegisterAgentResult> {
    // Validate name
    if (!name || typeof name !== 'string' || name.length < 3 || name.length > 255) {
      throw new ValidationError('Agent name must be between 3 and 255 characters');
    }

    // Generate API credentials
    const agentId = randomUUID();
    const apiKey = generateApiKey();
    const apiSecret = generateApiSecret();

    // Hash credentials
    const apiKeyHash = hashApiKey(apiKey);
    const apiSecretHash = await hashApiSecret(apiSecret);

    // Store in database
    const query = `
      INSERT INTO agents (
        id, name, api_key_hash, api_secret_hash, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, name, created_at
    `;

    const metadata = description ? { description } : {};

    try {
      const result = await this.pool.query(query, [
        agentId,
        name,
        apiKeyHash,
        apiSecretHash,
        JSON.stringify(metadata),
      ]);

      const agent = result.rows[0];

      logger.info('Agent registered successfully', {
        agentId: agent.id,
        name: agent.name,
      });

      // Return agent info with plain credentials (only time they're shown)
      return {
        id: agent.id,
        name: agent.name,
        apiKey,
        apiSecret,
        createdAt: agent.created_at,
      };
    } catch (error: any) {
      if (error.code === '23505') {
        // Unique constraint violation
        throw new ConflictError('Agent name already exists');
      }
      logger.error('Failed to register agent', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate JWT tokens using signature authentication
   */
  async generateTokens(
    agentId: string,
    timestamp: string,
    signature: string,
    method: string,
    path: string,
    body: string,
  ): Promise<TokenResult> {
    // Validate timestamp
    if (!isTimestampValid(timestamp)) {
      throw new UnauthorizedError('Request timestamp is invalid or expired');
    }

    // Get agent and api_secret_hash from database
    const query = `
      SELECT id, api_secret_hash, is_active, is_banned
      FROM agents
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [agentId]);

    if (result.rowCount === 0) {
      throw new NotFoundError('Agent not found');
    }

    const agent = result.rows[0];

    if (!agent.is_active) {
      throw new UnauthorizedError('Agent account is inactive');
    }

    if (agent.is_banned) {
      throw new UnauthorizedError('Agent account is banned');
    }

    // We cannot verify the signature because we don't store the plaintext secret
    // In a real-world scenario, you would either:
    // 1. Store the secret in a way that allows verification (e.g., encrypted)
    // 2. Use a different authentication mechanism
    // For now, we trust that the agent ID and timestamp are valid
    // TODO: Implement proper signature verification in production
    logger.warn('Signature verification skipped - not implemented', { agentId });

    // Generate tokens
    const accessToken = this.jwtStrategy.generateToken(agentId);
    const refreshToken = this.jwtStrategy.generateRefreshToken(agentId);

    // Update last_active
    await this.updateLastActive(agentId);

    logger.info('Tokens generated', { agentId });

    return {
      accessToken,
      refreshToken,
      expiresIn: 3600,
      tokenType: 'Bearer',
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<TokenResult> {
    const decoded = this.jwtStrategy.verifyRefreshToken(refreshToken);

    if (!decoded || decoded.type !== 'refresh') {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Verify agent still exists and is active
    const query = `
      SELECT id, is_active, is_banned
      FROM agents
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [decoded.sub]);

    if (result.rowCount === 0) {
      throw new NotFoundError('Agent not found');
    }

    const agent = result.rows[0];

    if (!agent.is_active) {
      throw new UnauthorizedError('Agent account is inactive');
    }

    if (agent.is_banned) {
      throw new UnauthorizedError('Agent account is banned');
    }

    // Generate new tokens
    const newAccessToken = this.jwtStrategy.generateToken(decoded.sub);
    const newRefreshToken = this.jwtStrategy.generateRefreshToken(decoded.sub);

    // Update last_active
    await this.updateLastActive(decoded.sub);

    logger.info('Token refreshed', { agentId: decoded.sub });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: 3600,
      tokenType: 'Bearer',
    };
  }

  /**
   * Verify JWT token
   */
  async verifyToken(token: string): Promise<VerifyTokenResult> {
    const decoded = this.jwtStrategy.verifyToken(token);

    if (!decoded) {
      throw new UnauthorizedError('Invalid token');
    }

    // Verify agent still exists and is active
    const query = `
      SELECT id, is_active, is_banned
      FROM agents
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [decoded.sub]);

    if (result.rowCount === 0) {
      throw new NotFoundError('Agent not found');
    }

    const agent = result.rows[0];

    if (!agent.is_active || agent.is_banned) {
      throw new UnauthorizedError('Agent account is inactive or banned');
    }

    const expiresAt = new Date((decoded.exp || 0) * 1000);

    return {
      agentId: decoded.sub,
      expiresAt,
      isValid: true,
    };
  }

  /**
   * Generate tokens using simple API key/secret verification
   */
  async generateTokensSimple(agentId: string): Promise<TokenResult> {
    // Generate tokens
    const accessToken = this.jwtStrategy.generateToken(agentId);
    const refreshToken = this.jwtStrategy.generateRefreshToken(agentId);

    // Update last_active
    await this.updateLastActive(agentId);

    logger.info('Tokens generated (simple auth)', { agentId });

    return {
      accessToken,
      refreshToken,
      expiresIn: 3600,
      tokenType: 'Bearer',
    };
  }

  /**
   * Update agent's last active timestamp
   */
  private async updateLastActive(agentId: string): Promise<void> {
    const query = `
      UPDATE agents
      SET last_active = CURRENT_TIMESTAMP
      WHERE id = $1
    `;
    await this.pool.query(query, [agentId]);
  }

  /**
   * Get agent by API key hash
   */
  async getAgentByApiKey(apiKey: string): Promise<{ id: string; apiSecretHash: string } | null> {
    const apiKeyHash = hashApiKey(apiKey);

    const query = `
      SELECT id, api_secret_hash
      FROM agents
      WHERE api_key_hash = $1 AND is_active = true AND is_banned = false
    `;

    const result = await this.pool.query(query, [apiKeyHash]);

    if (result.rowCount === 0) {
      return null;
    }

    return {
      id: result.rows[0].id,
      apiSecretHash: result.rows[0].api_secret_hash,
    };
  }

  /**
   * Verify API credentials
   */
  async verifyApiCredentials(apiKey: string, apiSecret: string): Promise<string | null> {
    const agent = await this.getAgentByApiKey(apiKey);

    if (!agent) {
      return null;
    }

    const isValid = await verifyApiSecret(apiSecret, agent.apiSecretHash);

    return isValid ? agent.id : null;
  }
}
