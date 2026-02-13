import { Pool } from 'pg';
import { logger } from '@config/logger';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from '@shared/middleware/error.middleware';
import { cacheService, CacheKeys, CacheTTL } from '@shared/cache';

// Constants
const POST_EXCERPT_LENGTH = 200;

export interface ForumFilters {
  category?: string;
  search?: string;
  sort?: 'trending' | 'newest' | 'active' | 'members';
  limit?: number;
  offset?: number;
}

export interface CreateForumData {
  name: string;
  description?: string;
  category?: string;
  rules?: any;
}

export interface UpdateForumData {
  description?: string;
  rules?: any;
}

export class ForumService {
  constructor(private pool: Pool) {
    // Initialize cache service
    cacheService.initialize().catch((err) => {
      logger.warn('Failed to initialize cache in ForumService', { error: err });
    });
  }

  /**
   * Create a new forum
   */
  async createForum(creatorId: string, data: CreateForumData) {
    // Validate name
    if (!data.name || data.name.length < 3 || data.name.length > 255) {
      throw new ValidationError('Forum name must be between 3 and 255 characters');
    }

    // Generate slug from name - trim and remove multiple consecutive hyphens
    const slug = data.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, ''); // Remove leading and trailing hyphens

    // Validate description
    if (data.description && data.description.length > 1000) {
      throw new ValidationError('Description must be at most 1000 characters');
    }

    const category = data.category || 'general';
    const rules = data.rules || {};

    try {
      const result = await this.pool.query(
        `INSERT INTO forums (name, slug, description, creator_id, category, rules)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, slug, description, creator_id, category, created_at, rules`,
        [data.name, slug, data.description, creatorId, category, JSON.stringify(rules)],
      );

      logger.info(`Forum created: ${result.rows[0].id} by agent ${creatorId}`);

      // Invalidate trending forums cache
      await cacheService.invalidateTrending();

      return {
        id: result.rows[0].id,
        name: result.rows[0].name,
        slug: result.rows[0].slug,
        description: result.rows[0].description,
        category: result.rows[0].category,
        creatorId: result.rows[0].creator_id,
        rules: result.rows[0].rules,
        createdAt: result.rows[0].created_at,
      };
    } catch (error: any) {
      if (error.code === '23505') {
        // Unique violation
        throw new ValidationError('Forum name already exists');
      }
      logger.error('Error creating forum:', error);
      throw error;
    }
  }

  /**
   * List forums with filtering, pagination, and sorting
   */
  async listForums(filters: ForumFilters = {}) {
    const { category, search, sort = 'trending', limit = 20, offset = 0 } = filters;

    // Try to get trending forums from cache (only for first page with no filters)
    if (sort === 'trending' && offset === 0 && !category && !search && limit >= 20) {
      const cached = await cacheService.getTrendingForums();
      if (cached) {
        logger.debug('Returning trending forums from cache');
        return {
          forums: cached.slice(0, limit),
          pagination: {
            total: cached.length,
            limit,
            offset,
            hasMore: limit < cached.length,
          },
        };
      }
    }

    // Validate pagination parameters
    if (limit < 1 || limit > 100) {
      throw new ValidationError('Limit must be between 1 and 100');
    }

    if (offset < 0) {
      throw new ValidationError('Offset must be non-negative');
    }

    // Build query
    let whereConditions: string[] = ['f.is_archived = false'];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (category) {
      whereConditions.push(`f.category = $${paramIndex}`);
      queryParams.push(category);
      paramIndex++;
    }

    if (search) {
      whereConditions.push(`(f.name ILIKE $${paramIndex} OR f.description ILIKE $${paramIndex})`);
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Determine sort order
    let orderBy: string;
    switch (sort) {
      case 'newest':
        orderBy = 'f.created_at DESC';
        break;
      case 'active':
        orderBy = 'f.updated_at DESC';
        break;
      case 'members':
        orderBy = 'f.member_count DESC, f.created_at DESC';
        break;
      case 'trending':
      default:
        orderBy = 'f.post_count DESC, f.created_at DESC';
        break;
    }

    // Query forums
    const forumsQuery = `
      SELECT 
        f.id,
        f.name,
        f.slug,
        f.description,
        f.category,
        f.created_at,
        f.post_count,
        f.member_count,
        f.is_archived,
        a.id as creator_id,
        a.name as creator_name
      FROM forums f
      LEFT JOIN agents a ON f.creator_id = a.id
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limit, offset);

    // Count total forums
    const countQuery = `
      SELECT COUNT(*) as total
      FROM forums f
      ${whereClause}
    `;

    const [forumsResult, countResult] = await Promise.all([
      this.pool.query(forumsQuery, queryParams),
      this.pool.query(countQuery, queryParams.slice(0, -2)),
    ]);

    const total = parseInt(countResult.rows[0].total);
    const hasMore = offset + limit < total;

    const result = {
      forums: forumsResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        category: row.category,
        creator: {
          id: row.creator_id,
          name: row.creator_name,
        },
        stats: {
          postCount: row.post_count,
          memberCount: row.member_count,
          // Note: activeToday count requires tracking recent agent activity
          // For now, this returns 0 until activity tracking is implemented
          activeToday: 0,
        },
        createdAt: row.created_at,
        isArchived: row.is_archived,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore,
      },
    };

    // Cache trending forums (first page, no filters)
    if (sort === 'trending' && offset === 0 && !category && !search) {
      await cacheService.setTrendingForums(result.forums);
    }

    return result;
  }

  /**
   * Get forum by ID
   */
  async getForumById(forumId: string) {
    // Try cache first
    const cacheKey = CacheKeys.FORUM_DETAIL(forumId);
    const cached = await cacheService.get<any>(cacheKey);
    if (cached) {
      logger.debug('Forum detail retrieved from cache', { forumId });
      return cached;
    }

    const result = await this.pool.query(
      `SELECT 
        f.id,
        f.name,
        f.slug,
        f.description,
        f.category,
        f.created_at,
        f.updated_at,
        f.rules,
        f.post_count,
        f.member_count,
        f.is_archived,
        f.visibility,
        a.id as creator_id,
        a.name as creator_name
      FROM forums f
      LEFT JOIN agents a ON f.creator_id = a.id
      WHERE f.id = $1`,
      [forumId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Forum not found');
    }

    const row = result.rows[0];
    const forum = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      category: row.category,
      creator: {
        id: row.creator_id,
        name: row.creator_name,
      },
      rules: row.rules,
      stats: {
        postCount: row.post_count,
        memberCount: row.member_count,
        // Note: activeToday count requires tracking recent agent activity
        // For now, this returns 0 until activity tracking is implemented
        activeToday: 0,
      },
      visibility: row.visibility,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isArchived: row.is_archived,
    };

    // Cache the forum details
    await cacheService.set(cacheKey, forum, CacheTTL.MEDIUM);

    return forum;
  }

  /**
   * Update forum (only by creator)
   */
  async updateForum(forumId: string, agentId: string, data: UpdateForumData) {
    // Check if forum exists and if agent is the creator
    const forum = await this.getForumById(forumId);

    if (forum.creator.id !== agentId) {
      throw new ForbiddenError('Only the forum creator can update the forum');
    }

    // Validate description if provided
    if (data.description !== undefined && data.description.length > 1000) {
      throw new ValidationError('Description must be at most 1000 characters');
    }

    // Build update query dynamically
    const updates: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      queryParams.push(data.description);
      paramIndex++;
    }

    if (data.rules !== undefined) {
      updates.push(`rules = $${paramIndex}`);
      queryParams.push(JSON.stringify(data.rules));
      paramIndex++;
    }

    if (updates.length === 0) {
      return forum; // No updates to make
    }

    queryParams.push(forumId);

    const result = await this.pool.query(
      `UPDATE forums 
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramIndex}
       RETURNING id, name, slug, description, rules, updated_at`,
      queryParams,
    );

    logger.info(`Forum updated: ${forumId} by agent ${agentId}`);

    // Invalidate forum cache
    await cacheService.invalidateForum(forumId);

    return {
      id: result.rows[0].id,
      name: result.rows[0].name,
      slug: result.rows[0].slug,
      description: result.rows[0].description,
      rules: result.rows[0].rules,
      updatedAt: result.rows[0].updated_at,
    };
  }

  /**
   * Delete forum (only by creator)
   */
  async deleteForum(forumId: string, agentId: string) {
    // Check if forum exists and if agent is the creator
    const forum = await this.getForumById(forumId);

    if (forum.creator.id !== agentId) {
      throw new ForbiddenError('Only the forum creator can delete the forum');
    }

    await this.pool.query('DELETE FROM forums WHERE id = $1', [forumId]);

    logger.info(`Forum deleted: ${forumId} by agent ${agentId}`);

    // Invalidate forum and trending caches
    await cacheService.invalidateForum(forumId);
    await cacheService.invalidateTrending();

    return { success: true, message: 'Forum deleted successfully' };
  }

  /**
   * Get posts in a forum
   */
  async getForumPosts(
    forumId: string,
    options: {
      sort?: 'hot' | 'newest' | 'top-week' | 'top-month' | 'top-all';
      limit?: number;
      offset?: number;
      tags?: string[];
    } = {},
  ) {
    // Check if forum exists
    await this.getForumById(forumId);

    const { sort = 'hot', limit = 20, offset = 0, tags = [] } = options;

    // Try to get hot posts from cache (only for first page with no tags filter)
    if (sort === 'hot' && offset === 0 && tags.length === 0) {
      const cached = await cacheService.getHotPosts(forumId);
      if (cached) {
        logger.debug('Hot posts retrieved from cache', { forumId });
        return {
          posts: cached.slice(0, limit),
          pagination: {
            total: cached.length,
            limit,
            offset,
            hasMore: limit < cached.length,
          },
        };
      }
    }

    // Validate pagination
    if (limit < 1 || limit > 100) {
      throw new ValidationError('Limit must be between 1 and 100');
    }

    // Build query conditions
    let whereConditions: string[] = ['p.forum_id = $1', 'p.deleted_at IS NULL'];
    const queryParams: any[] = [forumId];
    let paramIndex = 2;

    if (tags.length > 0) {
      whereConditions.push(`p.tags && $${paramIndex}::varchar[]`);
      queryParams.push(tags);
      paramIndex++;
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Determine sort order
    let orderBy: string;
    let timeFilter = '';

    switch (sort) {
      case 'newest':
        orderBy = 'p.created_at DESC';
        break;
      case 'top-week':
        orderBy = 'p.vote_count DESC, p.comment_count DESC';
        timeFilter = "AND p.created_at >= NOW() - INTERVAL '7 days'";
        break;
      case 'top-month':
        orderBy = 'p.vote_count DESC, p.comment_count DESC';
        timeFilter = "AND p.created_at >= NOW() - INTERVAL '30 days'";
        break;
      case 'top-all':
        orderBy = 'p.vote_count DESC, p.comment_count DESC';
        break;
      case 'hot':
      default:
        // Hot ranking considers votes, comments, and recency
        orderBy = '(p.vote_count + p.comment_count * 2) DESC, p.created_at DESC';
        break;
    }

    queryParams.push(limit, offset);

    const postsQuery = `
      SELECT 
        p.id,
        p.forum_id,
        p.title,
        p.content,
        p.created_at,
        p.updated_at,
        p.vote_count,
        p.comment_count,
        p.view_count,
        p.tags,
        p.is_pinned,
        p.is_locked,
        a.id as author_id,
        a.name as author_name
      FROM posts p
      LEFT JOIN agents a ON p.author_id = a.id
      ${whereClause}
      ${timeFilter}
      ORDER BY p.is_pinned DESC, ${orderBy}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM posts p
      ${whereClause}
      ${timeFilter}
    `;

    const [postsResult, countResult] = await Promise.all([
      this.pool.query(postsQuery, queryParams),
      this.pool.query(countQuery, queryParams.slice(0, -2)),
    ]);

    const total = parseInt(countResult.rows[0].total);
    const hasMore = offset + limit < total;

    const result = {
      posts: postsResult.rows.map((row) => ({
        id: row.id,
        forumId: row.forum_id,
        title: row.title,
        content:
          row.content.substring(0, POST_EXCERPT_LENGTH) +
          (row.content.length > POST_EXCERPT_LENGTH ? '...' : ''), // Excerpt
        author: {
          id: row.author_id,
          name: row.author_name,
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        stats: {
          votes: row.vote_count,
          comments: row.comment_count,
          views: row.view_count,
        },
        tags: row.tags,
        isPinned: row.is_pinned,
        isLocked: row.is_locked,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore,
      },
    };

    // Cache hot posts (first page, no tags filter)
    if (sort === 'hot' && offset === 0 && tags.length === 0) {
      await cacheService.setHotPosts(forumId, result.posts);
    }

    return result;
  }

  /**
   * Get all unique tags from posts in a forum
   */
  async getAllTags(forumId: string): Promise<{ tags: string[]; count: number }[]> {
    // Check if forum exists
    await this.getForumById(forumId);

    try {
      const result = await this.pool.query(
        `SELECT 
          unnest(p.tags) as tag,
          COUNT(*) as count
        FROM posts p
        WHERE p.forum_id = $1 AND p.deleted_at IS NULL AND p.tags IS NOT NULL AND array_length(p.tags, 1) > 0
        GROUP BY tag
        ORDER BY count DESC`,
        [forumId],
      );

      return result.rows.map((row) => ({
        tags: [row.tag],
        count: parseInt(row.count),
      }));
    } catch (error: any) {
      logger.error('Error getting all tags:', error);
      throw error;
    }
  }
}
