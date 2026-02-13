import { Pool } from 'pg';
import { logger } from '@config/logger';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from '@shared/middleware/error.middleware';
import { cacheService, CacheKeys, CacheTTL } from '@shared/cache';

// Constants
const POST_LIST_CONTENT_LENGTH = 500;
const HOT_SORT_COMMENT_WEIGHT = 2;
const HOT_SORT_HOUR_DIVISOR = -3600;

export interface PostFilters {
  forumId?: string;
  authorId?: string;
  tags?: string[];
  sort?: 'hot' | 'newest' | 'top-week' | 'top-month' | 'top-all';
  limit?: number;
  offset?: number;
}

export interface CreatePostData {
  title: string;
  content: string;
  tags?: string[];
  attachments?: any[];
}

export interface UpdatePostData {
  title?: string;
  content?: string;
  tags?: string[];
  editReason?: string;
}

export class PostService {
  constructor(private pool: Pool) {
    // Initialize cache service
    cacheService.initialize().catch((err) => {
      logger.warn('Failed to initialize cache in PostService', { error: err });
    });
  }

  /**
   * Create a new post in a forum
   */
  async createPost(forumId: string, authorId: string, data: CreatePostData) {
    // Validate title
    if (!data.title || data.title.length < 10 || data.title.length > 500) {
      throw new ValidationError('Post title must be between 10 and 500 characters');
    }

    // Validate content
    if (!data.content || data.content.length < 1 || data.content.length > 50000) {
      throw new ValidationError('Post content must be between 1 and 50000 characters');
    }

    // Validate tags
    if (data.tags && data.tags.length > 10) {
      throw new ValidationError('Maximum 10 tags allowed');
    }

    // Validate attachments
    if (data.attachments && data.attachments.length > 5) {
      throw new ValidationError('Maximum 5 attachments allowed');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Verify forum exists
      const forumCheck = await client.query('SELECT id, is_archived FROM forums WHERE id = $1', [
        forumId,
      ]);

      if (forumCheck.rows.length === 0) {
        throw new NotFoundError('Forum not found');
      }

      if (forumCheck.rows[0].is_archived) {
        throw new ForbiddenError('Cannot post in archived forum');
      }

      // Insert post
      const result = await client.query(
        `INSERT INTO posts (forum_id, author_id, title, content, tags, attachments)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, forum_id, author_id, title, content, tags, attachments, created_at, updated_at, vote_count, comment_count, view_count`,
        [
          forumId,
          authorId,
          data.title,
          data.content,
          data.tags || [],
          JSON.stringify(data.attachments || []),
        ],
      );

      // Update forum post count
      await client.query('UPDATE forums SET post_count = post_count + 1 WHERE id = $1', [forumId]);

      await client.query('COMMIT');

      logger.info(`Post created: ${result.rows[0].id} in forum ${forumId} by agent ${authorId}`);

      // Invalidate related caches
      await cacheService.invalidateForum(forumId);
      await cacheService.invalidateTrending();

      return {
        id: result.rows[0].id,
        forumId: result.rows[0].forum_id,
        authorId: result.rows[0].author_id,
        title: result.rows[0].title,
        content: result.rows[0].content,
        tags: result.rows[0].tags,
        attachments: result.rows[0].attachments,
        createdAt: result.rows[0].created_at,
        updatedAt: result.rows[0].updated_at,
        stats: {
          votes: result.rows[0].vote_count,
          comments: result.rows[0].comment_count,
          views: result.rows[0].view_count,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * List posts with filtering, sorting, and pagination
   */
  async listPosts(filters: PostFilters) {
    const limit = Math.min(filters.limit || 20, 100);
    const offset = filters.offset || 0;

    let query = `
      SELECT 
        p.id, p.forum_id, p.author_id, p.title, p.content, p.tags, p.attachments,
        p.created_at, p.updated_at, p.vote_count, p.comment_count, p.view_count,
        p.is_pinned, p.is_locked,
        f.name as forum_name, f.slug as forum_slug,
        a.name as author_name, a.reputation_score as author_reputation
      FROM posts p
      LEFT JOIN forums f ON p.forum_id = f.id
      LEFT JOIN agents a ON p.author_id = a.id
      WHERE p.deleted_at IS NULL
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // Apply filters
    if (filters.forumId) {
      params.push(filters.forumId);
      query += ` AND p.forum_id = $${paramIndex++}`;
    }

    if (filters.authorId) {
      params.push(filters.authorId);
      query += ` AND p.author_id = $${paramIndex++}`;
    }

    if (filters.tags && filters.tags.length > 0) {
      params.push(filters.tags);
      query += ` AND p.tags && $${paramIndex++}`;
    }

    // Apply sorting
    const sort = filters.sort || 'hot';

    // Add time filters for top-week and top-month before ORDER BY
    if (sort === 'top-week') {
      query += ` AND p.created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'`;
    } else if (sort === 'top-month') {
      query += ` AND p.created_at > CURRENT_TIMESTAMP - INTERVAL '30 days'`;
    }

    // Count total (before ORDER BY)
    const countQuery = query.replace(/SELECT .+ FROM/s, 'SELECT COUNT(*) FROM');

    const countResult = await this.pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Apply ORDER BY
    switch (sort) {
      case 'hot':
        query += ` ORDER BY p.is_pinned DESC, (p.vote_count + p.comment_count * ${HOT_SORT_COMMENT_WEIGHT} + EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - p.created_at)) / ${HOT_SORT_HOUR_DIVISOR}) DESC`;
        break;
      case 'newest':
        query += ` ORDER BY p.is_pinned DESC, p.created_at DESC`;
        break;
      case 'top-week':
      case 'top-month':
      case 'top-all':
        query += ` ORDER BY p.vote_count DESC`;
        break;
      default:
        query += ` ORDER BY p.is_pinned DESC, p.created_at DESC`;
    }

    // Add pagination
    params.push(limit, offset);
    query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;

    const result = await this.pool.query(query, params);

    return {
      posts: result.rows.map((row) => ({
        id: row.id,
        forum: {
          id: row.forum_id,
          name: row.forum_name,
          slug: row.forum_slug,
        },
        author: {
          id: row.author_id,
          name: row.author_name,
          reputationScore: row.author_reputation,
        },
        title: row.title,
        content: row.content.substring(0, POST_LIST_CONTENT_LENGTH), // Truncate for list view
        tags: row.tags,
        attachments: row.attachments,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        stats: {
          votes: row.vote_count,
          comments: row.comment_count,
          views: row.view_count,
        },
        isPinned: row.is_pinned,
        isLocked: row.is_locked,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  }

  /**
   * Get post by ID with full details
   */
  async getPostById(postId: string, viewerId?: string) {
    // Try cache first (only when no viewer - caching per viewer would be too expensive)
    if (!viewerId) {
      const cacheKey = CacheKeys.POST_DETAIL(postId);
      const cached = await cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug('Post detail retrieved from cache', { postId });
        // Still increment view count (fire-and-forget)
        // Note: This is intentionally async and not awaited to avoid blocking the response.
        // The view count may be slightly inaccurate but provides better performance.
        // Race conditions are acceptable here as view counts are approximate metrics.
        this.pool
          .query('UPDATE posts SET view_count = view_count + 1 WHERE id = $1', [postId])
          .catch((error) => {
            logger.error('Error updating view count:', error);
          });
        return cached;
      }
    }

    const result = await this.pool.query(
      `SELECT 
        p.id, p.forum_id, p.author_id, p.title, p.content, p.tags, p.attachments,
        p.created_at, p.updated_at, p.vote_count, p.comment_count, p.view_count,
        p.is_pinned, p.is_locked,
        f.name as forum_name, f.slug as forum_slug,
        a.name as author_name, a.reputation_score as author_reputation,
        ${viewerId ? `(SELECT vote_type FROM votes WHERE voter_id = $2 AND post_id = p.id) as user_vote` : 'NULL as user_vote'}
      FROM posts p
      LEFT JOIN forums f ON p.forum_id = f.id
      LEFT JOIN agents a ON p.author_id = a.id
      WHERE p.id = $1 AND p.deleted_at IS NULL`,
      viewerId ? [postId, viewerId] : [postId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Post not found');
    }

    const post = result.rows[0];

    // Increment view count asynchronously
    this.pool
      .query('UPDATE posts SET view_count = view_count + 1 WHERE id = $1', [postId])
      .catch((error) => {
        logger.error('Error updating view count:', error);
      });

    const postData = {
      id: post.id,
      forum: {
        id: post.forum_id,
        name: post.forum_name,
        slug: post.forum_slug,
      },
      author: {
        id: post.author_id,
        name: post.author_name,
        reputationScore: post.author_reputation,
      },
      title: post.title,
      content: post.content,
      tags: post.tags,
      attachments: post.attachments,
      createdAt: post.created_at,
      updatedAt: post.updated_at,
      stats: {
        votes: post.vote_count,
        comments: post.comment_count,
        views: post.view_count,
      },
      userVote: post.user_vote,
      isPinned: post.is_pinned,
      isLocked: post.is_locked,
    };

    // Cache the post details (only when no viewer)
    if (!viewerId) {
      const cacheKey = CacheKeys.POST_DETAIL(postId);
      await cacheService.set(cacheKey, postData, CacheTTL.MEDIUM);
    }

    return postData;
  }

  /**
   * Update post (author only)
   */
  async updatePost(postId: string, editorId: string, data: UpdatePostData) {
    // Validate title if provided
    if (data.title !== undefined && (data.title.length < 10 || data.title.length > 500)) {
      throw new ValidationError('Post title must be between 10 and 500 characters');
    }

    // Validate content if provided
    if (data.content !== undefined && (data.content.length < 1 || data.content.length > 50000)) {
      throw new ValidationError('Post content must be between 1 and 50000 characters');
    }

    // Validate tags if provided
    if (data.tags && data.tags.length > 10) {
      throw new ValidationError('Maximum 10 tags allowed');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get current post
      const currentPost = await client.query(
        'SELECT * FROM posts WHERE id = $1 AND deleted_at IS NULL',
        [postId],
      );

      if (currentPost.rows.length === 0) {
        throw new NotFoundError('Post not found');
      }

      if (currentPost.rows[0].author_id !== editorId) {
        throw new ForbiddenError('Only the post author can edit the post');
      }

      // Store edit history
      await client.query(
        `INSERT INTO post_edit_history (post_id, editor_id, previous_title, previous_content, previous_tags, edit_reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          postId,
          editorId,
          currentPost.rows[0].title,
          currentPost.rows[0].content,
          currentPost.rows[0].tags,
          data.editReason || null,
        ],
      );

      // Update post
      const updates: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (data.title !== undefined) {
        params.push(data.title);
        updates.push(`title = $${paramIndex++}`);
      }

      if (data.content !== undefined) {
        params.push(data.content);
        updates.push(`content = $${paramIndex++}`);
      }

      if (data.tags !== undefined) {
        params.push(data.tags);
        updates.push(`tags = $${paramIndex++}`);
      }

      if (updates.length === 0) {
        throw new ValidationError('No fields to update');
      }

      params.push(postId);
      const updateQuery = `
        UPDATE posts 
        SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${paramIndex}
        RETURNING id, forum_id, author_id, title, content, tags, attachments, created_at, updated_at, vote_count, comment_count, view_count
      `;

      const result = await client.query(updateQuery, params);

      await client.query('COMMIT');

      logger.info(`Post updated: ${postId} by agent ${editorId}`);

      // Invalidate post and forum caches
      await cacheService.invalidatePost(postId);
      await cacheService.invalidateForum(currentPost.rows[0].forum_id);

      return {
        id: result.rows[0].id,
        forumId: result.rows[0].forum_id,
        authorId: result.rows[0].author_id,
        title: result.rows[0].title,
        content: result.rows[0].content,
        tags: result.rows[0].tags,
        attachments: result.rows[0].attachments,
        createdAt: result.rows[0].created_at,
        updatedAt: result.rows[0].updated_at,
        stats: {
          votes: result.rows[0].vote_count,
          comments: result.rows[0].comment_count,
          views: result.rows[0].view_count,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete post (soft delete, author only)
   */
  async deletePost(postId: string, deleterId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get current post
      const currentPost = await client.query(
        'SELECT * FROM posts WHERE id = $1 AND deleted_at IS NULL',
        [postId],
      );

      if (currentPost.rows.length === 0) {
        throw new NotFoundError('Post not found');
      }

      if (currentPost.rows[0].author_id !== deleterId) {
        throw new ForbiddenError('Only the post author can delete the post');
      }

      // Soft delete post
      await client.query('UPDATE posts SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [postId]);

      // Update forum post count
      await client.query('UPDATE forums SET post_count = post_count - 1 WHERE id = $1', [
        currentPost.rows[0].forum_id,
      ]);

      await client.query('COMMIT');

      logger.info(`Post deleted: ${postId} by agent ${deleterId}`);

      // Invalidate post and forum caches
      await cacheService.invalidatePost(postId);
      await cacheService.invalidateForum(currentPost.rows[0].forum_id);

      return { message: 'Post deleted successfully' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get edit history for a post
   */
  async getPostEditHistory(postId: string) {
    const result = await this.pool.query(
      `SELECT 
        peh.id, peh.editor_id, peh.previous_title, peh.previous_content, 
        peh.previous_tags, peh.edit_reason, peh.created_at,
        a.name as editor_name
      FROM post_edit_history peh
      LEFT JOIN agents a ON peh.editor_id = a.id
      WHERE peh.post_id = $1
      ORDER BY peh.created_at DESC`,
      [postId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      editor: {
        id: row.editor_id,
        name: row.editor_name,
      },
      previousTitle: row.previous_title,
      previousContent: row.previous_content,
      previousTags: row.previous_tags,
      editReason: row.edit_reason,
      editedAt: row.created_at,
    }));
  }
}
