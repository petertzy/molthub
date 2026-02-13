import { Pool } from 'pg';
import crypto from 'crypto';
import { logger } from '@config/logger';
import { hashApiKey, hashPassword } from '@modules/auth/auth.utils';
import { NotFoundError, ForbiddenError } from '@shared/middleware/error.middleware';

/**
 * API Key Rotation Service
 * 
 * Provides mechanisms for rotating API keys and secrets to enhance security.
 * Supports graceful rotation with overlap periods to prevent service disruption.
 */

export interface ApiKeyRotationResult {
  newApiKey: string;
  newApiSecret: string;
  expiresAt: Date;
}

export interface ApiKeyInfo {
  keyHash: string;
  createdAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
  rotatedFromKeyHash: string | null;
}

export class KeyRotationService {
  constructor(private pool: Pool) {}

  /**
   * Rotate API key and secret for an agent
   * Keeps old key active for overlap period to prevent service disruption
   * 
   * @param agentId - Agent ID
   * @param overlapHours - Hours to keep old key active (default: 24)
   */
  async rotateApiKey(agentId: string, overlapHours = 24): Promise<ApiKeyRotationResult> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Verify agent exists
      const agentCheck = await client.query(
        'SELECT id, api_key_hash FROM agents WHERE id = $1',
        [agentId]
      );

      if (agentCheck.rows.length === 0) {
        throw new NotFoundError('Agent not found');
      }

      const oldKeyHash = agentCheck.rows[0].api_key_hash;

      // Generate new API key and secret
      const newApiKey = crypto.randomBytes(32).toString('hex');
      const newApiSecret = crypto.randomBytes(32).toString('hex');

      // Hash the credentials
      const newKeyHash = hashApiKey(newApiKey);
      const newSecretHash = await hashPassword(newApiSecret);

      // Calculate expiration for new key (never expires by default)
      const expiresAt = null;

      // Set expiration for old key (overlap period)
      const oldKeyExpiresAt = new Date();
      oldKeyExpiresAt.setHours(oldKeyExpiresAt.getHours() + overlapHours);

      // Store old key in rotation history
      await client.query(
        `INSERT INTO api_key_rotation_history 
         (agent_id, old_key_hash, new_key_hash, expires_at, rotated_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [agentId, oldKeyHash, newKeyHash, oldKeyExpiresAt]
      );

      // Update agent with new credentials
      await client.query(
        `UPDATE agents 
         SET api_key_hash = $1, api_secret_hash = $2, updated_at = NOW()
         WHERE id = $3`,
        [newKeyHash, newSecretHash, agentId]
      );

      await client.query('COMMIT');

      logger.info('API key rotated successfully', {
        agentId,
        oldKeyHash: oldKeyHash.substring(0, 8),
        newKeyHash: newKeyHash.substring(0, 8),
        overlapHours,
      });

      return {
        newApiKey,
        newApiSecret,
        expiresAt: expiresAt as any, // null means never expires
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to rotate API key', { agentId, error });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Verify if an API key is valid (current or in overlap period)
   * 
   * @param apiKeyHash - Hashed API key
   * @returns Agent ID if valid, null if invalid/expired
   */
  async verifyApiKey(apiKeyHash: string): Promise<string | null> {
    const client = await this.pool.connect();

    try {
      // Check if it's the current key
      const currentKeyResult = await client.query(
        'SELECT id FROM agents WHERE api_key_hash = $1 AND status = $2',
        [apiKeyHash, 'active']
      );

      if (currentKeyResult.rows.length > 0) {
        return currentKeyResult.rows[0].id;
      }

      // Check if it's an old key still in overlap period
      const oldKeyResult = await client.query(
        `SELECT agent_id FROM api_key_rotation_history 
         WHERE old_key_hash = $1 AND expires_at > NOW()`,
        [apiKeyHash]
      );

      if (oldKeyResult.rows.length > 0) {
        logger.info('Using old API key in overlap period', {
          keyHash: apiKeyHash.substring(0, 8),
          agentId: oldKeyResult.rows[0].agent_id,
        });
        return oldKeyResult.rows[0].agent_id;
      }

      return null;
    } finally {
      client.release();
    }
  }

  /**
   * Revoke old API keys immediately (end overlap period early)
   * 
   * @param agentId - Agent ID
   */
  async revokeOldKeys(agentId: string): Promise<void> {
    await this.pool.query(
      `UPDATE api_key_rotation_history 
       SET expires_at = NOW(), revoked_at = NOW()
       WHERE agent_id = $1 AND expires_at > NOW()`,
      [agentId]
    );

    logger.info('Old API keys revoked', { agentId });
  }

  /**
   * Get rotation history for an agent
   * 
   * @param agentId - Agent ID
   * @param limit - Maximum number of records to return
   */
  async getRotationHistory(agentId: string, limit = 10): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT 
         id,
         old_key_hash,
         new_key_hash,
         rotated_at,
         expires_at,
         revoked_at
       FROM api_key_rotation_history
       WHERE agent_id = $1
       ORDER BY rotated_at DESC
       LIMIT $2`,
      [agentId, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      oldKeyHash: row.old_key_hash.substring(0, 8) + '...',
      newKeyHash: row.new_key_hash.substring(0, 8) + '...',
      rotatedAt: row.rotated_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    }));
  }

  /**
   * Clean up expired rotation history
   * Should be run periodically (e.g., daily cron job)
   */
  async cleanupExpiredKeys(): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM api_key_rotation_history 
       WHERE expires_at < NOW() - INTERVAL '30 days'
       RETURNING id`
    );

    const deletedCount = result.rowCount || 0;
    
    if (deletedCount > 0) {
      logger.info('Cleaned up expired rotation history', { deletedCount });
    }

    return deletedCount;
  }

  /**
   * Get API keys expiring soon
   * Useful for proactive rotation reminders
   * 
   * @param daysThreshold - Days before expiration to alert
   */
  async getExpiringKeys(daysThreshold = 7): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT 
         agent_id,
         expires_at,
         EXTRACT(DAY FROM (expires_at - NOW())) as days_until_expiration
       FROM api_key_rotation_history
       WHERE expires_at > NOW() 
         AND expires_at < NOW() + INTERVAL '${daysThreshold} days'
       ORDER BY expires_at ASC`
    );

    return result.rows;
  }

  /**
   * Force rotate all keys (emergency use only)
   * Use when a security breach is suspected
   * 
   * @param reason - Reason for mass rotation
   */
  async forceRotateAllKeys(reason: string): Promise<number> {
    const client = await this.pool.connect();
    let rotatedCount = 0;

    try {
      await client.query('BEGIN');

      // Get all active agents
      const agentsResult = await client.query(
        'SELECT id FROM agents WHERE status = $1',
        ['active']
      );

      // Rotate keys for each agent
      for (const agent of agentsResult.rows) {
        try {
          await this.rotateApiKey(agent.id, 1); // 1 hour overlap
          rotatedCount++;
        } catch (error) {
          logger.error('Failed to rotate key during mass rotation', {
            agentId: agent.id,
            error,
          });
        }
      }

      // Log mass rotation event
      await client.query(
        `INSERT INTO security_events (event_type, severity, description, metadata)
         VALUES ($1, $2, $3, $4)`,
        [
          'MASS_KEY_ROTATION',
          'HIGH',
          reason,
          JSON.stringify({ rotatedCount, timestamp: new Date() }),
        ]
      );

      await client.query('COMMIT');

      logger.warn('Mass API key rotation completed', {
        reason,
        rotatedCount,
        totalAgents: agentsResult.rows.length,
      });

      return rotatedCount;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Mass key rotation failed', { error, reason });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Initialize rotation tables if they don't exist
   */
  async initializeTables(): Promise<void> {
    const client = await this.pool.connect();

    try {
      // Create rotation history table
      await client.query(`
        CREATE TABLE IF NOT EXISTS api_key_rotation_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          old_key_hash VARCHAR(255) NOT NULL,
          new_key_hash VARCHAR(255) NOT NULL,
          rotated_at TIMESTAMP DEFAULT NOW(),
          expires_at TIMESTAMP,
          revoked_at TIMESTAMP,
          CONSTRAINT fk_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
        )
      `);

      // Create index for faster lookups
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_rotation_history_agent 
        ON api_key_rotation_history(agent_id, rotated_at DESC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_rotation_history_old_key 
        ON api_key_rotation_history(old_key_hash, expires_at)
      `);

      // Create security events table for audit trail
      await client.query(`
        CREATE TABLE IF NOT EXISTS security_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          event_type VARCHAR(100) NOT NULL,
          severity VARCHAR(20) NOT NULL,
          description TEXT,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_security_events_type_time 
        ON security_events(event_type, created_at DESC)
      `);

      logger.info('Key rotation tables initialized');
    } catch (error) {
      logger.error('Failed to initialize key rotation tables', { error });
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * JWT Secret Rotation
 * For rotating JWT signing secrets (less frequent, more disruptive)
 */
export class JwtSecretRotationService {
  private currentSecret: string;
  private previousSecret: string | null = null;
  private rotationDate: Date | null = null;

  constructor(initialSecret: string) {
    this.currentSecret = initialSecret;
  }

  /**
   * Rotate JWT secret
   * Note: This will invalidate all existing tokens after grace period
   */
  rotateSecret(newSecret: string, gracePeriodHours = 1): void {
    this.previousSecret = this.currentSecret;
    this.currentSecret = newSecret;
    this.rotationDate = new Date();

    // Schedule cleanup of old secret
    setTimeout(() => {
      this.previousSecret = null;
      logger.info('JWT secret rotation grace period ended, old secret cleared');
    }, gracePeriodHours * 60 * 60 * 1000);

    logger.warn('JWT secret rotated', {
      gracePeriodHours,
      rotationDate: this.rotationDate,
    });
  }

  getCurrentSecret(): string {
    return this.currentSecret;
  }

  getPreviousSecret(): string | null {
    return this.previousSecret;
  }

  isInGracePeriod(): boolean {
    return this.previousSecret !== null;
  }
}
