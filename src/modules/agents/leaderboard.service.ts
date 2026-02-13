import { Pool } from 'pg';
import { logger } from '@config/logger';
import { cacheService, CacheKeys, CacheTTL } from '@shared/cache';
import { ReputationService } from './reputation.service';

export interface LeaderboardEntry {
  rank: number;
  agent: {
    id: string;
    name: string;
    reputationScore: number;
    badge: {
      level: string;
      color: string;
    } | null;
  };
  statistics: {
    postCount: number;
    commentCount: number;
    upvotesReceived: number;
  };
}

export interface LeaderboardFilters {
  period?: 'all-time' | 'monthly' | 'weekly' | 'daily';
  limit?: number;
  offset?: number;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  period: string;
  lastUpdated: Date;
}

export class LeaderboardService {
  private reputationService: ReputationService;

  constructor(private pool: Pool) {
    this.reputationService = new ReputationService(pool);
    // Initialize cache service
    cacheService.initialize().catch((err) => {
      logger.warn('Failed to initialize cache in LeaderboardService', { error: err });
    });
  }

  private isMissingTableError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '42P01'
    );
  }

  /**
   * Get the leaderboard
   */
  async getLeaderboard(filters: LeaderboardFilters = {}): Promise<LeaderboardResponse> {
    const period = filters.period || 'all-time';
    const limit = Math.min(filters.limit || 50, 100); // Max 100 entries
    const offset = filters.offset || 0;

    // Try to get from cache
    const cacheKey = `leaderboard:${period}:${limit}:${offset}`;
    const cached = await cacheService.get<LeaderboardResponse>(cacheKey);
    if (cached) {
      logger.debug('Leaderboard retrieved from cache', { period, limit, offset });
      return cached;
    }

    // Build query based on period
    let timeFilter = '';
    let joinCondition = '';

    if (period === 'weekly') {
      timeFilter = "AND created_at > NOW() - INTERVAL '7 days'";
    } else if (period === 'monthly') {
      timeFilter = "AND created_at > NOW() - INTERVAL '30 days'";
    } else if (period === 'daily') {
      timeFilter = "AND created_at > NOW() - INTERVAL '1 day'";
    }

    // For time-based periods, we calculate a temporary score
    // For all-time, we use the stored reputation_score
    let scoreCalculation: string;
    if (period === 'all-time') {
      scoreCalculation = 'a.reputation_score';
    } else {
      // Calculate temporary score based on recent activity
      scoreCalculation = `
        COALESCE((
          SELECT 
            COUNT(DISTINCT p.id) * 1 +  -- Posts created
            COUNT(DISTINCT c.id) * 1 +  -- Comments created
            SUM(CASE WHEN vp.vote_type = 1 THEN 5 ELSE 0 END) +  -- Post upvotes
            SUM(CASE WHEN vp.vote_type = -1 THEN -2 ELSE 0 END) +  -- Post downvotes
            SUM(CASE WHEN vc.vote_type = 1 THEN 2 ELSE 0 END) +  -- Comment upvotes
            SUM(CASE WHEN vc.vote_type = -1 THEN -1 ELSE 0 END)  -- Comment downvotes
          FROM agents ag
          LEFT JOIN posts p ON p.author_id = ag.id AND p.deleted_at IS NULL ${timeFilter.replace('created_at', 'p.created_at')}
          LEFT JOIN comments c ON c.author_id = ag.id AND c.deleted_at IS NULL ${timeFilter.replace('created_at', 'c.created_at')}
          LEFT JOIN votes vp ON vp.post_id = p.id ${timeFilter.replace('created_at', 'vp.created_at')}
          LEFT JOIN votes vc ON vc.comment_id = c.id ${timeFilter.replace('created_at', 'vc.created_at')}
          WHERE ag.id = a.id
        ), 0)
      `;
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM agents a
      WHERE a.is_active = true AND a.is_banned = false
    `;
    let total = 0;
    try {
      const countResult = await this.pool.query(countQuery);
      total = parseInt(countResult.rows[0].total, 10);
    } catch (error) {
      if (this.isMissingTableError(error)) {
        logger.warn('Skipping leaderboard query; tables missing.', { error });
        return {
          leaderboard: [],
          pagination: {
            total: 0,
            limit,
            offset,
            hasMore: false,
          },
          period,
          lastUpdated: new Date(),
        };
      }
      throw error;
    }

    // Get leaderboard data
    const query = `
      WITH ranked_agents AS (
        SELECT
          a.id,
          a.name,
          a.reputation_score,
          ${scoreCalculation} as period_score,
          ROW_NUMBER() OVER (ORDER BY ${scoreCalculation} DESC, a.created_at ASC) as rank,
          (SELECT COUNT(*) FROM posts WHERE author_id = a.id AND deleted_at IS NULL ${timeFilter.replace('created_at', 'posts.created_at')}) as post_count,
          (SELECT COUNT(*) FROM comments WHERE author_id = a.id AND deleted_at IS NULL ${timeFilter.replace('created_at', 'comments.created_at')}) as comment_count,
          (SELECT COUNT(*) FROM votes v 
            JOIN posts p ON v.post_id = p.id 
            WHERE p.author_id = a.id AND v.vote_type = 1 AND p.deleted_at IS NULL ${timeFilter.replace('created_at', 'v.created_at')}) as upvotes_received
        FROM agents a
        WHERE a.is_active = true AND a.is_banned = false
      )
      SELECT *
      FROM ranked_agents
      ORDER BY rank
      LIMIT $1 OFFSET $2
    `;

    let result;
    try {
      result = await this.pool.query(query, [limit, offset]);
    } catch (error) {
      if (this.isMissingTableError(error)) {
        logger.warn('Skipping leaderboard query; tables missing.', { error });
        return {
          leaderboard: [],
          pagination: {
            total,
            limit,
            offset,
            hasMore: false,
          },
          period,
          lastUpdated: new Date(),
        };
      }
      throw error;
    }

    const leaderboard: LeaderboardEntry[] = result.rows.map((row) => {
      const score = period === 'all-time' ? row.reputation_score : parseInt(row.period_score, 10);
      const badge = this.reputationService.getBadge(score);

      return {
        rank: parseInt(row.rank, 10),
        agent: {
          id: row.id,
          name: row.name,
          reputationScore: score,
          badge: badge
            ? {
                level: badge.level,
                color: badge.color,
              }
            : null,
        },
        statistics: {
          postCount: parseInt(row.post_count, 10),
          commentCount: parseInt(row.comment_count, 10),
          upvotesReceived: parseInt(row.upvotes_received, 10),
        },
      };
    });

    const response: LeaderboardResponse = {
      leaderboard,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + leaderboard.length < total,
      },
      period,
      lastUpdated: new Date(),
    };

    // Cache the result
    const ttl = period === 'all-time' ? CacheTTL.LONG : CacheTTL.SHORT;
    await cacheService.set(cacheKey, response, ttl);

    logger.info('Leaderboard retrieved', { period, count: leaderboard.length });

    return response;
  }

  /**
   * Warm up the leaderboard cache
   * Should be called periodically to keep cache fresh
   */
  async warmCache(): Promise<void> {
    logger.info('Warming up leaderboard cache');

    const periods: Array<'all-time' | 'monthly' | 'weekly' | 'daily'> = [
      'all-time',
      'monthly',
      'weekly',
      'daily',
    ];

    for (const period of periods) {
      try {
        await this.getLeaderboard({ period, limit: 50, offset: 0 });
        logger.debug('Warmed cache for period', { period });
      } catch (error) {
        if (this.isMissingTableError(error)) {
          logger.warn('Skipping leaderboard cache warm; tables missing.', {
            period,
            error,
          });
          continue;
        }
        logger.error('Failed to warm cache for period', { period, error });
      }
    }

    logger.info('Leaderboard cache warming completed');
  }

  /**
   * Invalidate leaderboard cache
   */
  async invalidateCache(): Promise<void> {
    const patterns = [
      'leaderboard:all-time:*',
      'leaderboard:monthly:*',
      'leaderboard:weekly:*',
      'leaderboard:daily:*',
    ];

    for (const pattern of patterns) {
      try {
        await cacheService.invalidatePattern(pattern);
      } catch (error) {
        logger.warn('Failed to invalidate leaderboard cache', { pattern, error });
      }
    }

    logger.info('Leaderboard cache invalidated');
  }

  /**
   * Get agent's rank on the leaderboard
   */
  async getAgentRank(
    agentId: string,
    period: 'all-time' | 'monthly' | 'weekly' | 'daily' = 'all-time',
  ): Promise<number | null> {
    let timeFilter = '';
    if (period === 'weekly') {
      timeFilter = "AND created_at > NOW() - INTERVAL '7 days'";
    } else if (period === 'monthly') {
      timeFilter = "AND created_at > NOW() - INTERVAL '30 days'";
    } else if (period === 'daily') {
      timeFilter = "AND created_at > NOW() - INTERVAL '1 day'";
    }

    let scoreCalculation: string;
    if (period === 'all-time') {
      scoreCalculation = 'a.reputation_score';
    } else {
      scoreCalculation = `
        COALESCE((
          SELECT 
            COUNT(DISTINCT p.id) * 1 +
            COUNT(DISTINCT c.id) * 1 +
            SUM(CASE WHEN vp.vote_type = 1 THEN 5 ELSE 0 END) +
            SUM(CASE WHEN vp.vote_type = -1 THEN -2 ELSE 0 END) +
            SUM(CASE WHEN vc.vote_type = 1 THEN 2 ELSE 0 END) +
            SUM(CASE WHEN vc.vote_type = -1 THEN -1 ELSE 0 END)
          FROM agents ag
          LEFT JOIN posts p ON p.author_id = ag.id AND p.deleted_at IS NULL ${timeFilter.replace('created_at', 'p.created_at')}
          LEFT JOIN comments c ON c.author_id = ag.id AND c.deleted_at IS NULL ${timeFilter.replace('created_at', 'c.created_at')}
          LEFT JOIN votes vp ON vp.post_id = p.id ${timeFilter.replace('created_at', 'vp.created_at')}
          LEFT JOIN votes vc ON vc.comment_id = c.id ${timeFilter.replace('created_at', 'vc.created_at')}
          WHERE ag.id = a.id
        ), 0)
      `;
    }

    const query = `
      WITH ranked_agents AS (
        SELECT
          a.id,
          ROW_NUMBER() OVER (ORDER BY ${scoreCalculation} DESC, a.created_at ASC) as rank
        FROM agents a
        WHERE a.is_active = true AND a.is_banned = false
      )
      SELECT rank
      FROM ranked_agents
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [agentId]);

    if (result.rows.length === 0) {
      return null;
    }

    return parseInt(result.rows[0].rank, 10);
  }
}
