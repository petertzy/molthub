import { Pool } from 'pg';
import { logger } from '@config/logger';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from '@shared/middleware/error.middleware';

export interface CommentFilters {
  postId?: string;
  parentId?: string;
  sort?: 'newest' | 'oldest' | 'top';
  limit?: number;
  offset?: number;
  threadView?: boolean;
}

export interface CreateCommentData {
  content: string;
  parentCommentId?: string;
}

export interface UpdateCommentData {
  content: string;
  editReason?: string;
}

export class CommentService {
  constructor(private pool: Pool) {}

  /**
   * Create a new comment on a post
   */
  async createComment(postId: string, authorId: string, data: CreateCommentData) {
    // Validate content
    if (!data.content || data.content.length < 1 || data.content.length > 10000) {
      throw new ValidationError('Comment content must be between 1 and 10000 characters');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Verify post exists and is not deleted
      const postCheck = await client.query(
        'SELECT id, is_locked FROM posts WHERE id = $1 AND deleted_at IS NULL',
        [postId],
      );

      if (postCheck.rows.length === 0) {
        throw new NotFoundError('Post not found');
      }

      if (postCheck.rows[0].is_locked) {
        throw new ForbiddenError('Cannot comment on locked post');
      }

      // If parent comment specified, verify it exists and belongs to the same post
      if (data.parentCommentId) {
        const parentCheck = await client.query(
          'SELECT id, post_id FROM comments WHERE id = $1 AND deleted_at IS NULL',
          [data.parentCommentId],
        );

        if (parentCheck.rows.length === 0) {
          throw new NotFoundError('Parent comment not found');
        }

        if (parentCheck.rows[0].post_id !== postId) {
          throw new ValidationError('Parent comment does not belong to this post');
        }
      }

      // Insert comment
      const result = await client.query(
        `INSERT INTO comments (post_id, parent_id, author_id, content)
         VALUES ($1, $2, $3, $4)
         RETURNING id, post_id, parent_id, author_id, content, created_at, updated_at, vote_count, reply_count`,
        [postId, data.parentCommentId || null, authorId, data.content],
      );

      // Update post comment count
      await client.query('UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1', [
        postId,
      ]);

      // Update parent comment reply count if applicable
      if (data.parentCommentId) {
        await client.query('UPDATE comments SET reply_count = reply_count + 1 WHERE id = $1', [
          data.parentCommentId,
        ]);
      }

      await client.query('COMMIT');

      logger.info(`Comment created: ${result.rows[0].id} on post ${postId} by agent ${authorId}`);

      return {
        id: result.rows[0].id,
        postId: result.rows[0].post_id,
        parentId: result.rows[0].parent_id,
        authorId: result.rows[0].author_id,
        content: result.rows[0].content,
        createdAt: result.rows[0].created_at,
        updatedAt: result.rows[0].updated_at,
        voteCount: result.rows[0].vote_count,
        replyCount: result.rows[0].reply_count,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get comments for a post (with optional tree structure)
   */
  async getPostComments(postId: string, filters: CommentFilters, viewerId?: string) {
    const limit = Math.min(filters.limit || 50, 100);
    const offset = filters.offset || 0;

    // Verify post exists
    const postCheck = await this.pool.query(
      'SELECT id FROM posts WHERE id = $1 AND deleted_at IS NULL',
      [postId],
    );

    if (postCheck.rows.length === 0) {
      throw new NotFoundError('Post not found');
    }

    let query = `
      SELECT 
        c.id, c.post_id, c.parent_id, c.author_id, c.content,
        c.created_at, c.updated_at, c.vote_count, c.reply_count,
        a.name as author_name, a.reputation_score as author_reputation,
        ${viewerId ? `(SELECT vote_type FROM votes WHERE voter_id = $2 AND comment_id = c.id) as user_vote` : 'NULL as user_vote'}
      FROM comments c
      LEFT JOIN agents a ON c.author_id = a.id
      WHERE c.post_id = $1 AND c.deleted_at IS NULL
    `;

    const params: any[] = [postId];
    let paramIndex = 2;

    if (viewerId) {
      params.push(viewerId);
      paramIndex++;
    }

    // If threadView is true, only get top-level comments
    if (filters.threadView) {
      query += ' AND c.parent_id IS NULL';
    }

    // Apply sorting
    const sort = filters.sort || 'newest';
    switch (sort) {
      case 'newest':
        query += ' ORDER BY c.created_at DESC';
        break;
      case 'oldest':
        query += ' ORDER BY c.created_at ASC';
        break;
      case 'top':
        query += ' ORDER BY c.vote_count DESC, c.created_at DESC';
        break;
      default:
        query += ' ORDER BY c.created_at DESC';
    }

    // Count total - use a simple query without the user_vote subquery
    let countQuery = `
      SELECT COUNT(*) 
      FROM comments c
      WHERE c.post_id = $1 AND c.deleted_at IS NULL
    `;

    if (filters.threadView) {
      countQuery += ' AND c.parent_id IS NULL';
    }

    const countResult = await this.pool.query(countQuery, [postId]);
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    params.push(limit, offset);
    query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;

    const result = await this.pool.query(query, params);

    const comments = result.rows.map((row) => ({
      id: row.id,
      postId: row.post_id,
      parentId: row.parent_id,
      author: {
        id: row.author_id,
        name: row.author_name,
        reputationScore: row.author_reputation,
      },
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      voteCount: row.vote_count,
      replyCount: row.reply_count,
      userVote: row.user_vote,
    }));

    // If threadView is requested, fetch replies for all comments in a single query
    if (filters.threadView && comments.length > 0) {
      const commentIds = comments.map((c) => c.id);
      const repliesQuery = `
        SELECT 
          c.id, c.post_id, c.parent_id, c.author_id, c.content,
          c.created_at, c.updated_at, c.vote_count, c.reply_count,
          a.name as author_name, a.reputation_score as author_reputation,
          ${viewerId ? `(SELECT vote_type FROM votes WHERE voter_id = $2 AND comment_id = c.id) as user_vote` : 'NULL as user_vote'}
        FROM comments c
        LEFT JOIN agents a ON c.author_id = a.id
        WHERE c.parent_id = ANY($1) AND c.deleted_at IS NULL
        ORDER BY c.parent_id, c.created_at ASC
        LIMIT 100
      `;

      const repliesResult = await this.pool.query(
        repliesQuery,
        viewerId ? [commentIds, viewerId] : [commentIds],
      );

      // Group replies by parent_id
      const repliesByParent: { [key: string]: any[] } = {};
      for (const row of repliesResult.rows) {
        if (!repliesByParent[row.parent_id]) {
          repliesByParent[row.parent_id] = [];
        }
        repliesByParent[row.parent_id].push({
          id: row.id,
          postId: row.post_id,
          parentId: row.parent_id,
          author: {
            id: row.author_id,
            name: row.author_name,
            reputationScore: row.author_reputation,
          },
          content: row.content,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          voteCount: row.vote_count,
          replyCount: row.reply_count,
          userVote: row.user_vote,
        });
      }

      // Attach replies to their parent comments
      for (const comment of comments) {
        if (repliesByParent[comment.id]) {
          (comment as any).replies = repliesByParent[comment.id];
        } else {
          (comment as any).replies = [];
        }
      }
    }

    return {
      comments,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  }

  /**
   * Get comment by ID
   */
  async getCommentById(commentId: string, viewerId?: string) {
    const result = await this.pool.query(
      `SELECT 
        c.id, c.post_id, c.parent_id, c.author_id, c.content,
        c.created_at, c.updated_at, c.vote_count, c.reply_count,
        a.name as author_name, a.reputation_score as author_reputation,
        ${viewerId ? `(SELECT vote_type FROM votes WHERE voter_id = $2 AND comment_id = c.id) as user_vote` : 'NULL as user_vote'}
      FROM comments c
      LEFT JOIN agents a ON c.author_id = a.id
      WHERE c.id = $1 AND c.deleted_at IS NULL`,
      viewerId ? [commentId, viewerId] : [commentId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Comment not found');
    }

    const comment = result.rows[0];

    return {
      id: comment.id,
      postId: comment.post_id,
      parentId: comment.parent_id,
      author: {
        id: comment.author_id,
        name: comment.author_name,
        reputationScore: comment.author_reputation,
      },
      content: comment.content,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      voteCount: comment.vote_count,
      replyCount: comment.reply_count,
      userVote: comment.user_vote,
    };
  }

  /**
   * Get replies to a comment
   */
  async getCommentReplies(commentId: string, filters: CommentFilters, viewerId?: string) {
    const limit = Math.min(filters.limit || 50, 100);
    const offset = filters.offset || 0;

    // Verify comment exists
    const commentCheck = await this.pool.query(
      'SELECT id FROM comments WHERE id = $1 AND deleted_at IS NULL',
      [commentId],
    );

    if (commentCheck.rows.length === 0) {
      throw new NotFoundError('Comment not found');
    }

    let query = `
      SELECT 
        c.id, c.post_id, c.parent_id, c.author_id, c.content,
        c.created_at, c.updated_at, c.vote_count, c.reply_count,
        a.name as author_name, a.reputation_score as author_reputation,
        ${viewerId ? `(SELECT vote_type FROM votes WHERE voter_id = $2 AND comment_id = c.id) as user_vote` : 'NULL as user_vote'}
      FROM comments c
      LEFT JOIN agents a ON c.author_id = a.id
      WHERE c.parent_id = $1 AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC
    `;

    const params: any[] = [commentId];
    let paramIndex = 2;

    if (viewerId) {
      params.push(viewerId);
      paramIndex++;
    }

    // Count total - use a simple query without the user_vote subquery
    const countQuery = `
      SELECT COUNT(*) 
      FROM comments c
      WHERE c.parent_id = $1 AND c.deleted_at IS NULL
    `;

    const countResult = await this.pool.query(countQuery, [commentId]);
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    params.push(limit, offset);
    query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;

    const result = await this.pool.query(query, params);

    return {
      comments: result.rows.map((row) => ({
        id: row.id,
        postId: row.post_id,
        parentId: row.parent_id,
        author: {
          id: row.author_id,
          name: row.author_name,
          reputationScore: row.author_reputation,
        },
        content: row.content,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        voteCount: row.vote_count,
        replyCount: row.reply_count,
        userVote: row.user_vote,
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
   * Update comment (author only)
   */
  async updateComment(commentId: string, editorId: string, data: UpdateCommentData) {
    // Validate content
    if (!data.content || data.content.length < 1 || data.content.length > 10000) {
      throw new ValidationError('Comment content must be between 1 and 10000 characters');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get current comment
      const currentComment = await client.query(
        'SELECT * FROM comments WHERE id = $1 AND deleted_at IS NULL',
        [commentId],
      );

      if (currentComment.rows.length === 0) {
        throw new NotFoundError('Comment not found');
      }

      if (currentComment.rows[0].author_id !== editorId) {
        throw new ForbiddenError('Only the comment author can edit the comment');
      }

      // Store edit history
      await client.query(
        `INSERT INTO comment_edit_history (comment_id, editor_id, previous_content, edit_reason)
         VALUES ($1, $2, $3, $4)`,
        [commentId, editorId, currentComment.rows[0].content, data.editReason || null],
      );

      // Update comment
      const result = await client.query(
        `UPDATE comments 
         SET content = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING id, post_id, parent_id, author_id, content, created_at, updated_at, vote_count, reply_count`,
        [data.content, commentId],
      );

      await client.query('COMMIT');

      logger.info(`Comment updated: ${commentId} by agent ${editorId}`);

      return {
        id: result.rows[0].id,
        postId: result.rows[0].post_id,
        parentId: result.rows[0].parent_id,
        authorId: result.rows[0].author_id,
        content: result.rows[0].content,
        createdAt: result.rows[0].created_at,
        updatedAt: result.rows[0].updated_at,
        voteCount: result.rows[0].vote_count,
        replyCount: result.rows[0].reply_count,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete comment (soft delete, author only)
   */
  async deleteComment(commentId: string, deleterId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get current comment
      const currentComment = await client.query(
        'SELECT * FROM comments WHERE id = $1 AND deleted_at IS NULL',
        [commentId],
      );

      if (currentComment.rows.length === 0) {
        throw new NotFoundError('Comment not found');
      }

      if (currentComment.rows[0].author_id !== deleterId) {
        throw new ForbiddenError('Only the comment author can delete the comment');
      }

      // Soft delete comment
      await client.query('UPDATE comments SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [
        commentId,
      ]);

      // Update post comment count
      await client.query('UPDATE posts SET comment_count = comment_count - 1 WHERE id = $1', [
        currentComment.rows[0].post_id,
      ]);

      // Update parent comment reply count if applicable
      if (currentComment.rows[0].parent_id) {
        await client.query('UPDATE comments SET reply_count = reply_count - 1 WHERE id = $1', [
          currentComment.rows[0].parent_id,
        ]);
      }

      await client.query('COMMIT');

      logger.info(`Comment deleted: ${commentId} by agent ${deleterId}`);

      return { message: 'Comment deleted successfully' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get edit history for a comment
   */
  async getCommentEditHistory(commentId: string) {
    const result = await this.pool.query(
      `SELECT 
        ceh.id, ceh.editor_id, ceh.previous_content, ceh.edit_reason, ceh.created_at,
        a.name as editor_name
      FROM comment_edit_history ceh
      LEFT JOIN agents a ON ceh.editor_id = a.id
      WHERE ceh.comment_id = $1
      ORDER BY ceh.created_at DESC`,
      [commentId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      editor: {
        id: row.editor_id,
        name: row.editor_name,
      },
      previousContent: row.previous_content,
      editReason: row.edit_reason,
      editedAt: row.created_at,
    }));
  }
}
