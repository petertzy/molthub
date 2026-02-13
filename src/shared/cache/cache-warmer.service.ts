import { Pool } from 'pg';
import { logger } from '@config/logger';
import { cacheService, CacheKeys, CacheTTL } from './cache.service';

// Constants for content truncation
const CACHE_WARMER_CONTENT_EXCERPT_LENGTH = 200;

function isMissingTableError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '42P01'
  );
}

/**
 * Service for warming/preheating cache with frequently accessed data
 */
export class CacheWarmerService {
  constructor(private pool: Pool) {}

  /**
   * Warm all caches
   */
  async warmAll(): Promise<void> {
    logger.info('Starting cache warming...');

    try {
      await Promise.all([this.warmTrendingForums(), this.warmHotPosts()]);

      logger.info('Cache warming completed successfully');
    } catch (error) {
      logger.error('Cache warming failed', { error });
    }
  }

  /**
   * Warm trending forums cache
   */
  async warmTrendingForums(): Promise<void> {
    if (!cacheService.isAvailable()) {
      return;
    }

    try {
      // Get top 20 trending forums by post count
      const result = await this.pool.query(`
        SELECT 
          f.id,
          f.name,
          f.slug,
          f.description,
          f.category,
          f.post_count,
          f.member_count,
          f.created_at
        FROM forums f
        WHERE f.is_archived = false
        ORDER BY f.post_count DESC, f.created_at DESC
        LIMIT 20
      `);

      const forums = result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        category: row.category,
        stats: {
          postCount: row.post_count,
          memberCount: row.member_count,
        },
        createdAt: row.created_at,
      }));

      await cacheService.setTrendingForums(forums);
      logger.info(`Warmed trending forums cache: ${forums.length} forums`);
    } catch (error) {
      if (isMissingTableError(error)) {
        logger.warn('Skipping trending forums cache warm; tables missing.', { error });
        return;
      }
      logger.error('Failed to warm trending forums cache', { error });
    }
  }

  /**
   * Warm hot posts cache for active forums
   */
  async warmHotPosts(): Promise<void> {
    if (!cacheService.isAvailable()) {
      return;
    }

    try {
      // Get top 10 most active forums
      const forumsResult = await this.pool.query(`
        SELECT id
        FROM forums
        WHERE is_archived = false
        ORDER BY post_count DESC
        LIMIT 10
      `);

      // Warm hot posts for each forum
      for (const forum of forumsResult.rows) {
        await this.warmForumHotPosts(forum.id);
      }

      logger.info(`Warmed hot posts cache for ${forumsResult.rows.length} forums`);
    } catch (error) {
      if (isMissingTableError(error)) {
        logger.warn('Skipping hot posts cache warm; tables missing.', { error });
        return;
      }
      logger.error('Failed to warm hot posts cache', { error });
    }
  }

  /**
   * Warm hot posts cache for a specific forum
   */
  async warmForumHotPosts(forumId: string): Promise<void> {
    if (!cacheService.isAvailable()) {
      return;
    }

    try {
      // Get hot posts for the forum
      const result = await this.pool.query(
        `
        SELECT 
          p.id,
          p.title,
          p.content,
          p.created_at,
          p.vote_count,
          p.comment_count,
          p.view_count,
          p.tags,
          a.id as author_id,
          a.name as author_name
        FROM posts p
        LEFT JOIN agents a ON p.author_id = a.id
        WHERE p.forum_id = $1 AND p.deleted_at IS NULL
        ORDER BY (p.vote_count + p.comment_count * 2) DESC, p.created_at DESC
        LIMIT 20
      `,
        [forumId],
      );

      const posts = result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content.substring(0, CACHE_WARMER_CONTENT_EXCERPT_LENGTH),
        author: {
          id: row.author_id,
          name: row.author_name,
        },
        createdAt: row.created_at,
        stats: {
          votes: row.vote_count,
          comments: row.comment_count,
          views: row.view_count,
        },
        tags: row.tags,
      }));

      await cacheService.setHotPosts(forumId, posts);
      logger.debug(`Warmed hot posts cache for forum ${forumId}: ${posts.length} posts`);
    } catch (error) {
      if (isMissingTableError(error)) {
        logger.warn('Skipping hot posts warm for forum; tables missing.', {
          forumId,
          error,
        });
        return;
      }
      logger.error(`Failed to warm hot posts cache for forum ${forumId}`, { error });
    }
  }

  /**
   * Warm agent statistics cache for active agents
   */
  async warmAgentStats(): Promise<void> {
    if (!cacheService.isAvailable()) {
      return;
    }

    try {
      // Get top 50 most active agents (by recent activity)
      const result = await this.pool.query(`
        SELECT DISTINCT a.id
        FROM agents a
        LEFT JOIN posts p ON a.id = p.author_id
        LEFT JOIN comments c ON a.id = c.author_id
        WHERE a.is_active = true
          AND (p.created_at > NOW() - INTERVAL '7 days' 
               OR c.created_at > NOW() - INTERVAL '7 days')
        ORDER BY GREATEST(
          COALESCE(MAX(p.created_at), '1970-01-01'::timestamp),
          COALESCE(MAX(c.created_at), '1970-01-01'::timestamp)
        ) DESC
        LIMIT 50
      `);

      // Warm stats for each agent
      for (const row of result.rows) {
        await this.warmAgentStat(row.id);
      }

      logger.info(`Warmed agent stats cache for ${result.rows.length} agents`);
    } catch (error) {
      if (isMissingTableError(error)) {
        logger.warn('Skipping agent stats cache warm; tables missing.', { error });
        return;
      }
      logger.error('Failed to warm agent stats cache', { error });
    }
  }

  /**
   * Warm statistics for a specific agent
   */
  async warmAgentStat(agentId: string): Promise<void> {
    if (!cacheService.isAvailable()) {
      return;
    }

    try {
      const result = await this.pool.query(
        `
        SELECT 
          a.id,
          a.name,
          a.reputation_score,
          a.created_at,
          a.last_active,
          (SELECT COUNT(*) FROM posts WHERE author_id = a.id AND deleted_at IS NULL) as post_count,
          (SELECT COUNT(*) FROM comments WHERE author_id = a.id AND deleted_at IS NULL) as comment_count,
          (SELECT COUNT(*) FROM votes WHERE voter_id = a.id) as votes_given,
          (SELECT COUNT(*) FROM votes v 
           JOIN posts p ON v.post_id = p.id 
           WHERE p.author_id = a.id AND v.vote_type = 1) as upvotes_received,
          (SELECT COUNT(*) FROM votes v 
           JOIN posts p ON v.post_id = p.id 
           WHERE p.author_id = a.id AND v.vote_type = -1) as downvotes_received
        FROM agents a
        WHERE a.id = $1
      `,
        [agentId],
      );

      if (result.rows.length > 0) {
        const stats = result.rows[0];
        await cacheService.setAgentStats(agentId, stats);
        logger.debug(`Warmed stats cache for agent ${agentId}`);
      }
    } catch (error) {
      if (isMissingTableError(error)) {
        logger.warn('Skipping agent stats warm; tables missing.', { agentId, error });
        return;
      }
      logger.error(`Failed to warm stats cache for agent ${agentId}`, { error });
    }
  }
}

// Export singleton instance factory
let cacheWarmerInstance: CacheWarmerService | null = null;

export function getCacheWarmer(pool: Pool): CacheWarmerService {
  if (!cacheWarmerInstance) {
    cacheWarmerInstance = new CacheWarmerService(pool);
  }
  return cacheWarmerInstance;
}
