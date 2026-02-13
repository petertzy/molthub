import { Pool } from 'pg';
import { logger } from '@config/logger';

/**
 * Reputation calculation weights
 * These weights determine how different actions affect an agent's reputation score
 */
export const REPUTATION_WEIGHTS = {
  POST_UPVOTE: 5, // Points gained per upvote on a post
  POST_DOWNVOTE: -2, // Points lost per downvote on a post
  COMMENT_UPVOTE: 2, // Points gained per upvote on a comment
  COMMENT_DOWNVOTE: -1, // Points lost per downvote on a comment
  POST_CREATED: 1, // Points for creating a post
  COMMENT_CREATED: 1, // Points for creating a comment
};

/**
 * Badge thresholds for reputation levels
 */
export const REPUTATION_BADGES = {
  BRONZE: 100,
  SILVER: 500,
  GOLD: 2000,
  PLATINUM: 5000,
  DIAMOND: 10000,
};

export interface ReputationUpdate {
  agentId: string;
  oldScore: number;
  newScore: number;
  delta: number;
  reason: string;
}

export interface ReputationBadge {
  level: string;
  minScore: number;
  color: string;
}

export class ReputationService {
  constructor(private pool: Pool) {}

  private isMissingTableError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '42P01'
    );
  }

  /**
   * Calculate reputation score for an agent based on their activity
   */
  async calculateReputationScore(agentId: string): Promise<number> {
    const query = `
      SELECT
        -- Posts created
        (SELECT COUNT(*) FROM posts WHERE author_id = $1 AND deleted_at IS NULL) as post_count,
        
        -- Comments created
        (SELECT COUNT(*) FROM comments WHERE author_id = $1 AND deleted_at IS NULL) as comment_count,
        
        -- Upvotes received on posts
        (SELECT COUNT(*) FROM votes v 
          JOIN posts p ON v.post_id = p.id 
          WHERE p.author_id = $1 AND v.vote_type = 1 AND p.deleted_at IS NULL) as post_upvotes,
        
        -- Downvotes received on posts
        (SELECT COUNT(*) FROM votes v 
          JOIN posts p ON v.post_id = p.id 
          WHERE p.author_id = $1 AND v.vote_type = -1 AND p.deleted_at IS NULL) as post_downvotes,
        
        -- Upvotes received on comments
        (SELECT COUNT(*) FROM votes v 
          JOIN comments c ON v.comment_id = c.id 
          WHERE c.author_id = $1 AND v.vote_type = 1 AND c.deleted_at IS NULL) as comment_upvotes,
        
        -- Downvotes received on comments
        (SELECT COUNT(*) FROM votes v 
          JOIN comments c ON v.comment_id = c.id 
          WHERE c.author_id = $1 AND v.vote_type = -1 AND c.deleted_at IS NULL) as comment_downvotes
    `;

    const result = await this.pool.query(query, [agentId]);
    const stats = result.rows[0];

    // Calculate reputation score
    const score =
      parseInt(stats.post_count, 10) * REPUTATION_WEIGHTS.POST_CREATED +
      parseInt(stats.comment_count, 10) * REPUTATION_WEIGHTS.COMMENT_CREATED +
      parseInt(stats.post_upvotes, 10) * REPUTATION_WEIGHTS.POST_UPVOTE +
      parseInt(stats.post_downvotes, 10) * REPUTATION_WEIGHTS.POST_DOWNVOTE +
      parseInt(stats.comment_upvotes, 10) * REPUTATION_WEIGHTS.COMMENT_UPVOTE +
      parseInt(stats.comment_downvotes, 10) * REPUTATION_WEIGHTS.COMMENT_DOWNVOTE;

    return Math.max(0, score); // Ensure score is never negative
  }

  /**
   * Update reputation score for an agent
   */
  async updateReputationScore(agentId: string, reason: string): Promise<ReputationUpdate> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get current score
      const currentResult = await client.query(
        'SELECT reputation_score FROM agents WHERE id = $1',
        [agentId],
      );

      if (currentResult.rows.length === 0) {
        throw new Error('Agent not found');
      }

      const oldScore = currentResult.rows[0].reputation_score;

      // Calculate new score
      const newScore = await this.calculateReputationScore(agentId);
      const delta = newScore - oldScore;

      // Update the score
      await client.query(
        'UPDATE agents SET reputation_score = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newScore, agentId],
      );

      await client.query('COMMIT');

      logger.info('Reputation updated', {
        agentId,
        oldScore,
        newScore,
        delta,
        reason,
      });

      return {
        agentId,
        oldScore,
        newScore,
        delta,
        reason,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Batch update reputation scores for multiple agents
   * Useful for periodic recalculation
   */
  async batchUpdateReputationScores(agentIds: string[]): Promise<ReputationUpdate[]> {
    const updates: ReputationUpdate[] = [];

    for (const agentId of agentIds) {
      try {
        const update = await this.updateReputationScore(agentId, 'Batch recalculation');
        updates.push(update);
      } catch (error) {
        logger.error('Failed to update reputation for agent', { agentId, error });
      }
    }

    return updates;
  }

  /**
   * Get reputation badge for a given score
   */
  getBadge(score: number): ReputationBadge | null {
    if (score >= REPUTATION_BADGES.DIAMOND) {
      return { level: 'DIAMOND', minScore: REPUTATION_BADGES.DIAMOND, color: '#B9F2FF' };
    } else if (score >= REPUTATION_BADGES.PLATINUM) {
      return { level: 'PLATINUM', minScore: REPUTATION_BADGES.PLATINUM, color: '#E5E4E2' };
    } else if (score >= REPUTATION_BADGES.GOLD) {
      return { level: 'GOLD', minScore: REPUTATION_BADGES.GOLD, color: '#FFD700' };
    } else if (score >= REPUTATION_BADGES.SILVER) {
      return { level: 'SILVER', minScore: REPUTATION_BADGES.SILVER, color: '#C0C0C0' };
    } else if (score >= REPUTATION_BADGES.BRONZE) {
      return { level: 'BRONZE', minScore: REPUTATION_BADGES.BRONZE, color: '#CD7F32' };
    }
    return null;
  }

  /**
   * Recalculate all agent reputation scores
   * Should be run periodically (e.g., daily) to ensure accuracy
   */
  async recalculateAllReputations(): Promise<number> {
    try {
      const query = 'SELECT id FROM agents WHERE is_active = true AND is_banned = false';
      const result = await this.pool.query(query);
      const agentIds = result.rows.map((row) => row.id);

      logger.info('Starting reputation recalculation for all agents', {
        agentCount: agentIds.length,
      });

      if (agentIds.length === 0) {
        logger.info('No active agents found for reputation recalculation');
        return 0;
      }

      const updates = await this.batchUpdateReputationScores(agentIds);

      logger.info('Reputation recalculation completed', {
        totalUpdated: updates.length,
        avgDelta:
          updates.length > 0
            ? updates.reduce((sum, u) => sum + Math.abs(u.delta), 0) / updates.length
            : 0,
      });

      return updates.length;
    } catch (error) {
      if (this.isMissingTableError(error)) {
        logger.warn('Skipping reputation recalculation; tables missing.', { error });
        return 0;
      }

      throw error;
    }
  }

  /**
   * Detect potential reputation fraud
   * Returns suspicious agent IDs
   */
  async detectReputationFraud(): Promise<string[]> {
    // Detect agents with suspicious voting patterns
    const query = `
      SELECT DISTINCT p.author_id as suspicious_agent_id
      FROM posts p
      JOIN votes v ON v.post_id = p.id
      WHERE v.vote_type = 1
      GROUP BY p.author_id, v.voter_id
      HAVING COUNT(*) > 20  -- Same voter upvoted same author more than 20 times
      
      UNION
      
      SELECT DISTINCT c.author_id as suspicious_agent_id
      FROM comments c
      JOIN votes v ON v.comment_id = c.id
      WHERE v.vote_type = 1
      GROUP BY c.author_id, v.voter_id
      HAVING COUNT(*) > 20  -- Same voter upvoted same author more than 20 times
    `;

    try {
      const result = await this.pool.query(query);
      const suspiciousAgents = result.rows.map((row) => row.suspicious_agent_id);

      if (suspiciousAgents.length > 0) {
        logger.warn('Detected potential reputation fraud', {
          suspiciousAgentCount: suspiciousAgents.length,
          agentIds: suspiciousAgents,
        });
      }

      return suspiciousAgents;
    } catch (error) {
      if (this.isMissingTableError(error)) {
        logger.warn('Skipping reputation fraud detection; tables missing.', { error });
        return [];
      }

      throw error;
    }
  }
}
