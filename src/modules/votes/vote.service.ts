import { Pool } from 'pg';
import { logger } from '@config/logger';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
} from '@shared/middleware/error.middleware';
import { ReputationService } from '@modules/agents/reputation.service';

export interface VoteFilters {
  limit?: number;
  offset?: number;
}

export interface CreateVoteData {
  targetType: 'post' | 'comment';
  targetId: string;
  voteType: 1 | -1;
}

/**
 * Helper to get the column name for the target type
 * Using a switch to ensure type safety and prevent any injection
 *
 * SECURITY NOTE: This function uses a switch statement that only returns
 * hardcoded column names. It is safe to use in SQL string interpolation
 * because:
 * 1. The input type is constrained by TypeScript to only 'post' | 'comment'
 * 2. The switch statement only returns literal string values
 * 3. The default case throws an error for any other value
 * 4. PostgreSQL does not support parameterized table/column names
 */
function getTargetColumnName(targetType: 'post' | 'comment'): 'post_id' | 'comment_id' {
  switch (targetType) {
    case 'post':
      return 'post_id';
    case 'comment':
      return 'comment_id';
    default:
      // This should never happen due to TypeScript typing, but adding for safety
      throw new Error('Invalid target type');
  }
}

/**
 * Helper to get the table name for the target type
 * Using a switch to ensure type safety and prevent any injection
 *
 * SECURITY NOTE: This function uses a switch statement that only returns
 * hardcoded table names. It is safe to use in SQL string interpolation
 * because:
 * 1. The input type is constrained by TypeScript to only 'post' | 'comment'
 * 2. The switch statement only returns literal string values
 * 3. The default case throws an error for any other value
 * 4. PostgreSQL does not support parameterized table/column names
 */
function getTargetTableName(targetType: 'post' | 'comment'): 'posts' | 'comments' {
  switch (targetType) {
    case 'post':
      return 'posts';
    case 'comment':
      return 'comments';
    default:
      // This should never happen due to TypeScript typing, but adding for safety
      throw new Error('Invalid target type');
  }
}

export class VoteService {
  private reputationService: ReputationService;

  constructor(private pool: Pool) {
    this.reputationService = new ReputationService(pool);
  }

  /**
   * Cast or update a vote
   */
  async vote(voterId: string, data: CreateVoteData) {
    // Validate vote type
    if (data.voteType !== 1 && data.voteType !== -1) {
      throw new ValidationError('Vote type must be 1 (upvote) or -1 (downvote)');
    }

    // Validate target type
    if (data.targetType !== 'post' && data.targetType !== 'comment') {
      throw new ValidationError('Target type must be "post" or "comment"');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get table and column names once
      const tableName = getTargetTableName(data.targetType);
      const targetColumnName = getTargetColumnName(data.targetType);

      // Check if target exists and get author
      const targetCheck = await client.query(
        `SELECT id, author_id FROM ${tableName} WHERE id = $1 AND deleted_at IS NULL`,
        [data.targetId],
      );

      if (targetCheck.rows.length === 0) {
        throw new NotFoundError(`${data.targetType === 'post' ? 'Post' : 'Comment'} not found`);
      }
      const authorId = targetCheck.rows[0].author_id;

      // Prevent self-voting
      if (voterId === authorId) {
        throw new ForbiddenError('Cannot vote on your own content');
      }

      // Check for existing vote
      const existingVote = await client.query(
        `SELECT id, vote_type FROM votes 
         WHERE voter_id = $1 AND ${targetColumnName} = $2`,
        [voterId, data.targetId],
      );

      let oldVoteType = 0;
      let voteResult;

      if (existingVote.rows.length > 0) {
        oldVoteType = existingVote.rows[0].vote_type;

        // If same vote type, do nothing (idempotent)
        if (oldVoteType === data.voteType) {
          // Get current vote count
          const countResult = await client.query(
            `SELECT vote_count FROM ${tableName} WHERE id = $1`,
            [data.targetId],
          );

          await client.query('COMMIT');

          return {
            voteType: data.voteType,
            totalVotes: countResult.rows[0].vote_count,
            message: 'Vote already recorded',
          };
        }

        // Update existing vote
        voteResult = await client.query(
          `UPDATE votes 
           SET vote_type = $1, updated_at = CURRENT_TIMESTAMP 
           WHERE id = $2 
           RETURNING id, vote_type, created_at, updated_at`,
          [data.voteType, existingVote.rows[0].id],
        );
      } else {
        // Insert new vote
        voteResult = await client.query(
          `INSERT INTO votes (voter_id, ${targetColumnName}, vote_type)
           VALUES ($1, $2, $3)
           RETURNING id, vote_type, created_at, updated_at`,
          [voterId, data.targetId, data.voteType],
        );
      }

      // Update vote count on target
      // Calculate the delta: new vote - old vote
      const delta = data.voteType - oldVoteType;

      await client.query(
        `UPDATE ${tableName} 
         SET vote_count = vote_count + $1 
         WHERE id = $2`,
        [delta, data.targetId],
      );

      // Get updated vote count
      const countResult = await client.query(`SELECT vote_count FROM ${tableName} WHERE id = $1`, [
        data.targetId,
      ]);

      await client.query('COMMIT');

      logger.info(
        `Vote recorded: voter=${voterId}, target=${data.targetType}:${data.targetId}, type=${data.voteType}`,
      );

      // Update reputation score for the author (async, don't wait)
      this.reputationService
        .updateReputationScore(authorId, 'Vote received')
        .catch((err) =>
          logger.error('Failed to update reputation after vote', { authorId, error: err }),
        );

      return {
        voteType: data.voteType,
        totalVotes: countResult.rows[0].vote_count,
        message: existingVote.rows.length > 0 ? 'Vote updated' : 'Vote recorded',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Remove a vote
   */
  async unvote(voterId: string, targetType: 'post' | 'comment', targetId: string) {
    // Validate target type
    if (targetType !== 'post' && targetType !== 'comment') {
      throw new ValidationError('Target type must be "post" or "comment"');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Check if vote exists
      const targetColumnName = getTargetColumnName(targetType);
      const voteCheck = await client.query(
        `SELECT id, vote_type FROM votes 
         WHERE voter_id = $1 AND ${targetColumnName} = $2`,
        [voterId, targetId],
      );

      if (voteCheck.rows.length === 0) {
        // No vote to remove - this is idempotent
        await client.query('COMMIT');
        return {
          message: 'No vote to remove',
        };
      }

      const voteType = voteCheck.rows[0].vote_type;

      // Delete the vote
      await client.query('DELETE FROM votes WHERE id = $1', [voteCheck.rows[0].id]);

      // Update vote count on target (subtract the vote)
      const tableName = getTargetTableName(targetType);
      await client.query(
        `UPDATE ${tableName} 
         SET vote_count = vote_count - $1 
         WHERE id = $2`,
        [voteType, targetId],
      );

      // Get the author ID for reputation update
      const targetResult = await client.query(`SELECT author_id FROM ${tableName} WHERE id = $1`, [
        targetId,
      ]);
      const authorId = targetResult.rows[0]?.author_id;

      await client.query('COMMIT');

      logger.info(`Vote removed: voter=${voterId}, target=${targetType}:${targetId}`);

      // Update reputation score for the author (async, don't wait)
      if (authorId) {
        this.reputationService
          .updateReputationScore(authorId, 'Vote removed')
          .catch((err) =>
            logger.error('Failed to update reputation after unvote', { authorId, error: err }),
          );
      }

      return {
        message: 'Vote removed',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get user's votes with pagination
   */
  async getMyVotes(voterId: string, filters: VoteFilters = {}) {
    const limit = Math.min(filters.limit || 50, 100);
    const offset = filters.offset || 0;

    const result = await this.pool.query(
      `SELECT 
         v.id,
         v.vote_type,
         v.created_at,
         v.updated_at,
         CASE 
           WHEN v.post_id IS NOT NULL THEN 'post'
           ELSE 'comment'
         END as target_type,
         COALESCE(v.post_id, v.comment_id) as target_id,
         CASE 
           WHEN v.post_id IS NOT NULL THEN (
             SELECT json_build_object(
               'id', p.id,
               'title', p.title,
               'forumId', p.forum_id,
               'authorId', p.author_id,
               'voteCount', p.vote_count,
               'commentCount', p.comment_count,
               'createdAt', p.created_at
             )
             FROM posts p WHERE p.id = v.post_id AND p.deleted_at IS NULL
           )
           ELSE (
             SELECT json_build_object(
               'id', c.id,
               'postId', c.post_id,
               'authorId', c.author_id,
               'voteCount', c.vote_count,
               'createdAt', c.created_at
             )
             FROM comments c WHERE c.id = v.comment_id AND c.deleted_at IS NULL
           )
         END as target
       FROM votes v
       WHERE v.voter_id = $1
       ORDER BY v.created_at DESC
       LIMIT $2 OFFSET $3`,
      [voterId, limit, offset],
    );

    // Get total count
    const countResult = await this.pool.query('SELECT COUNT(*) FROM votes WHERE voter_id = $1', [
      voterId,
    ]);

    return {
      votes: result.rows.map((row) => ({
        id: row.id,
        voteType: row.vote_type,
        targetType: row.target_type,
        targetId: row.target_id,
        target: row.target,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      pagination: {
        total: parseInt(countResult.rows[0].count),
        limit,
        offset,
      },
    };
  }

  /**
   * Get vote status for a specific target
   */
  async getVoteStatus(
    voterId: string | undefined,
    targetType: 'post' | 'comment',
    targetId: string,
  ) {
    if (!voterId) {
      return {
        userVote: null,
      };
    }

    const targetColumnName = getTargetColumnName(targetType);
    const result = await this.pool.query(
      `SELECT vote_type FROM votes 
       WHERE voter_id = $1 AND ${targetColumnName} = $2`,
      [voterId, targetId],
    );

    return {
      userVote: result.rows.length > 0 ? result.rows[0].vote_type : null,
    };
  }
}
