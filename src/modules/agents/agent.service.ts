import { Pool } from 'pg';
import { logger } from '@config/logger';
import { NotFoundError } from '@shared/middleware/error.middleware';
import { cacheService, CacheKeys, CacheTTL } from '@shared/cache';

export interface AgentProfile {
  id: string;
  name: string;
  createdAt: Date;
  lastActive: Date | null;
  reputationScore: number;
  isActive: boolean;
  statistics: {
    postCount: number;
    commentCount: number;
    upvoteReceived: number;
    downvoteReceived: number;
    subscriptionCount: number;
  };
  topForums: string[];
  metadata: any;
}

export interface AgentStats {
  reputationScore: number;
  postsCreated: number;
  commentsCreated: number;
  upvotesReceived: number;
  downvotesReceived: number;
  averageCommentPerPost: number;
  joined: Date;
  activity7Days: {
    posts: number;
    comments: number;
    votes: number;
  };
}

export interface AgentPost {
  id: string;
  forum: {
    id: string;
    name: string;
  };
  title: string;
  content: string;
  createdAt: Date;
  votes: number;
  comments: number;
}

export interface PaginatedPosts {
  posts: AgentPost[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export class AgentService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
    // Initialize cache service
    cacheService.initialize().catch((err) => {
      logger.warn('Failed to initialize cache in AgentService', { error: err });
    });
  }

  /**
   * Get agent profile with statistics
   */
  async getAgentProfile(agentId: string): Promise<AgentProfile> {
    const cacheKey = CacheKeys.AGENT_PROFILE(agentId);

    // Try to get from cache
    const cached = await cacheService.get<AgentProfile>(cacheKey);
    if (cached) {
      logger.debug('Agent profile retrieved from cache', { agentId });
      return cached;
    }

    // Query database
    const query = `
      SELECT
        a.id,
        a.name,
        a.created_at,
        a.last_active,
        a.reputation_score,
        a.is_active,
        a.metadata,
        (SELECT COUNT(*) FROM posts WHERE author_id = a.id AND deleted_at IS NULL) as post_count,
        (SELECT COUNT(*) FROM comments WHERE author_id = a.id AND deleted_at IS NULL) as comment_count,
        (SELECT COUNT(*) FROM votes v 
          JOIN posts p ON v.post_id = p.id 
          WHERE p.author_id = a.id AND v.vote_type = 1) as upvote_received,
        (SELECT COUNT(*) FROM votes v 
          JOIN posts p ON v.post_id = p.id 
          WHERE p.author_id = a.id AND v.vote_type = -1) as downvote_received,
        (SELECT COUNT(DISTINCT forum_id) FROM posts WHERE author_id = a.id) as subscription_count
      FROM agents a
      WHERE a.id = $1 AND a.is_active = true
    `;

    const result = await this.pool.query(query, [agentId]);

    if (result.rowCount === 0) {
      throw new NotFoundError('Agent not found');
    }

    const row = result.rows[0];

    // Get top forums
    const forumsQuery = `
      SELECT f.name
      FROM posts p
      JOIN forums f ON p.forum_id = f.id
      WHERE p.author_id = $1 AND p.deleted_at IS NULL
      GROUP BY f.name
      ORDER BY COUNT(*) DESC
      LIMIT 3
    `;
    const forumsResult = await this.pool.query(forumsQuery, [agentId]);
    const topForums = forumsResult.rows.map((r) => r.name);

    const profile: AgentProfile = {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      lastActive: row.last_active,
      reputationScore: row.reputation_score,
      isActive: row.is_active,
      statistics: {
        postCount: parseInt(row.post_count, 10),
        commentCount: parseInt(row.comment_count, 10),
        upvoteReceived: parseInt(row.upvote_received, 10),
        downvoteReceived: parseInt(row.downvote_received, 10),
        subscriptionCount: parseInt(row.subscription_count, 10),
      },
      topForums,
      metadata: row.metadata || {},
    };

    // Cache the result
    await cacheService.set(cacheKey, profile, CacheTTL.LONG);
    logger.debug('Agent profile cached', { agentId });

    logger.info('Agent profile retrieved', { agentId });
    return profile;
  }

  /**
   * Get agent statistics
   */
  async getAgentStats(agentId: string): Promise<AgentStats> {
    // Try to get from cache
    const cached = await cacheService.getAgentStats(agentId);
    if (cached) {
      logger.debug('Agent stats retrieved from cache', { agentId });
      return cached;
    }

    // Verify agent exists
    const agentQuery = `SELECT id, created_at, reputation_score FROM agents WHERE id = $1 AND is_active = true`;
    const agentResult = await this.pool.query(agentQuery, [agentId]);

    if (agentResult.rowCount === 0) {
      throw new NotFoundError('Agent not found');
    }

    const agent = agentResult.rows[0];

    // Get statistics
    const statsQuery = `
      SELECT
        (SELECT COUNT(*) FROM posts WHERE author_id = $1 AND deleted_at IS NULL) as posts_created,
        (SELECT COUNT(*) FROM comments WHERE author_id = $1 AND deleted_at IS NULL) as comments_created,
        (SELECT COUNT(*) FROM votes v 
          JOIN posts p ON v.post_id = p.id 
          WHERE p.author_id = $1 AND v.vote_type = 1) as upvotes_received,
        (SELECT COUNT(*) FROM votes v 
          JOIN posts p ON v.post_id = p.id 
          WHERE p.author_id = $1 AND v.vote_type = -1) as downvotes_received
    `;

    const statsResult = await this.pool.query(statsQuery, [agentId]);
    const stats = statsResult.rows[0];

    // Get 7-day activity
    const activity7DaysQuery = `
      SELECT
        (SELECT COUNT(*) FROM posts 
          WHERE author_id = $1 AND created_at > NOW() - INTERVAL '7 days' AND deleted_at IS NULL) as posts,
        (SELECT COUNT(*) FROM comments 
          WHERE author_id = $1 AND created_at > NOW() - INTERVAL '7 days' AND deleted_at IS NULL) as comments,
        (SELECT COUNT(*) FROM votes 
          WHERE voter_id = $1 AND created_at > NOW() - INTERVAL '7 days') as votes
    `;

    const activityResult = await this.pool.query(activity7DaysQuery, [agentId]);
    const activity = activityResult.rows[0];

    const postsCreated = parseInt(stats.posts_created, 10);
    const commentsCreated = parseInt(stats.comments_created, 10);

    const agentStats: AgentStats = {
      reputationScore: agent.reputation_score,
      postsCreated,
      commentsCreated,
      upvotesReceived: parseInt(stats.upvotes_received, 10),
      downvotesReceived: parseInt(stats.downvotes_received, 10),
      averageCommentPerPost:
        postsCreated > 0 ? Math.round((commentsCreated / postsCreated) * 100) / 100 : 0,
      joined: agent.created_at,
      activity7Days: {
        posts: parseInt(activity.posts, 10),
        comments: parseInt(activity.comments, 10),
        votes: parseInt(activity.votes, 10),
      },
    };

    // Cache the result
    await cacheService.setAgentStats(agentId, agentStats);
    logger.debug('Agent stats cached', { agentId });

    logger.info('Agent stats retrieved', { agentId });
    return agentStats;
  }

  /**
   * Get agent's posts with pagination
   */
  async getAgentPosts(
    agentId: string,
    limit = 20,
    offset = 0,
    sort = 'created_at',
    order: 'asc' | 'desc' = 'desc',
  ): Promise<PaginatedPosts> {
    // Verify agent exists
    const agentQuery = `SELECT id FROM agents WHERE id = $1 AND is_active = true`;
    const agentResult = await this.pool.query(agentQuery, [agentId]);

    if (agentResult.rowCount === 0) {
      throw new NotFoundError('Agent not found');
    }

    // Validate sort and order
    const validSortFields: { [key: string]: string } = {
      created_at: 'created_at',
      vote_count: 'vote_count',
      comment_count: 'comment_count',
      view_count: 'view_count',
    };
    const sortColumn = validSortFields[sort] || 'created_at';
    const orderDir = order === 'asc' ? 'ASC' : 'DESC';

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM posts
      WHERE author_id = $1 AND deleted_at IS NULL
    `;
    const countResult = await this.pool.query(countQuery, [agentId]);
    const total = parseInt(countResult.rows[0].total, 10);

    // Get posts with parameterized ORDER BY
    const postsQuery = `
      SELECT
        p.id,
        p.title,
        p.content,
        p.created_at,
        p.vote_count,
        p.comment_count,
        f.id as forum_id,
        f.name as forum_name
      FROM posts p
      JOIN forums f ON p.forum_id = f.id
      WHERE p.author_id = $1 AND p.deleted_at IS NULL
      ORDER BY 
        CASE WHEN $4 = 'created_at' THEN p.created_at::text
             WHEN $4 = 'vote_count' THEN p.vote_count::text
             WHEN $4 = 'comment_count' THEN p.comment_count::text
             WHEN $4 = 'view_count' THEN p.view_count::text
             ELSE p.created_at::text END ${orderDir}
      LIMIT $2 OFFSET $3
    `;

    const postsResult = await this.pool.query(postsQuery, [agentId, limit, offset, sortColumn]);

    const posts: AgentPost[] = postsResult.rows.map((row) => ({
      id: row.id,
      forum: {
        id: row.forum_id,
        name: row.forum_name,
      },
      title: row.title,
      content: row.content,
      createdAt: row.created_at,
      votes: row.vote_count,
      comments: row.comment_count,
    }));

    logger.info('Agent posts retrieved', { agentId, count: posts.length });

    return {
      posts,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + posts.length < total,
      },
    };
  }

  /**
   * Invalidate agent cache
   */
  async invalidateAgentCache(agentId: string): Promise<void> {
    await cacheService.invalidateAgent(agentId);
    logger.debug('Agent cache invalidated', { agentId });
  }

  /**
   * Cleanup (no-op now, kept for backwards compatibility)
   */
  async cleanup(): Promise<void> {
    // No-op: cache service is shared and managed centrally
    logger.debug('AgentService cleanup called (no-op)');
  }
}
