import { Pool } from 'pg';
import { logger } from '@config/logger';
import { NotFoundError, ValidationError } from '@shared/middleware/error.middleware';
import {
  ForumSubscription,
  SubscriptionThread,
  SubscriptionSettings,
  ThreadSubscriptionSettings,
} from './notification.types';

export class SubscriptionService {
  constructor(private pool: Pool) {}

  /**
   * Subscribe to a forum
   */
  async subscribeToForum(
    agentId: string,
    forumId: string,
    settings: SubscriptionSettings = {},
  ): Promise<ForumSubscription> {
    const { notifyOnPost = true, notifyOnComment = false } = settings;

    try {
      const result = await this.pool.query(
        `INSERT INTO agent_subscriptions (agent_id, forum_id, notify_on_post, notify_on_comment)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (agent_id, forum_id) 
         DO UPDATE SET 
           notify_on_post = $3,
           notify_on_comment = $4,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id, agent_id, forum_id, notify_on_post, notify_on_comment, created_at, updated_at`,
        [agentId, forumId, notifyOnPost, notifyOnComment],
      );

      logger.info(`Agent ${agentId} subscribed to forum ${forumId}`);

      return {
        id: result.rows[0].id,
        agentId: result.rows[0].agent_id,
        forumId: result.rows[0].forum_id,
        notifyOnPost: result.rows[0].notify_on_post,
        notifyOnComment: result.rows[0].notify_on_comment,
        createdAt: result.rows[0].created_at,
        updatedAt: result.rows[0].updated_at,
      };
    } catch (error: any) {
      if (error.code === '23503') {
        // Foreign key violation
        throw new NotFoundError('Forum or agent not found');
      }
      logger.error('Error subscribing to forum:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe from a forum
   */
  async unsubscribeFromForum(agentId: string, forumId: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM agent_subscriptions
       WHERE agent_id = $1 AND forum_id = $2`,
      [agentId, forumId],
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('Subscription not found');
    }

    logger.info(`Agent ${agentId} unsubscribed from forum ${forumId}`);
  }

  /**
   * Get forum subscriptions for an agent
   */
  async getForumSubscriptions(agentId: string): Promise<ForumSubscription[]> {
    const result = await this.pool.query(
      `SELECT 
        s.id, s.agent_id, s.forum_id, s.notify_on_post, s.notify_on_comment,
        s.created_at, s.updated_at
       FROM agent_subscriptions s
       WHERE s.agent_id = $1
       ORDER BY s.created_at DESC`,
      [agentId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      forumId: row.forum_id,
      notifyOnPost: row.notify_on_post,
      notifyOnComment: row.notify_on_comment,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Check if agent is subscribed to a forum
   */
  async isSubscribedToForum(agentId: string, forumId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM agent_subscriptions
       WHERE agent_id = $1 AND forum_id = $2`,
      [agentId, forumId],
    );

    return result.rows.length > 0;
  }

  /**
   * Get subscribers of a forum
   */
  async getForumSubscribers(forumId: string, notifyOnPost: boolean = true): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT agent_id FROM agent_subscriptions
       WHERE forum_id = $1 AND notify_on_post = $2`,
      [forumId, notifyOnPost],
    );

    return result.rows.map((row) => row.agent_id);
  }

  /**
   * Subscribe to a post thread
   */
  async subscribeToPost(
    agentId: string,
    postId: string,
    settings: ThreadSubscriptionSettings = {},
  ): Promise<SubscriptionThread> {
    const { notifyOnReply = true, notifyOnVote = false } = settings;

    try {
      const result = await this.pool.query(
        `INSERT INTO subscription_threads (agent_id, post_id, notify_on_reply, notify_on_vote)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (agent_id, post_id) 
         DO UPDATE SET 
           notify_on_reply = $3,
           notify_on_vote = $4
         RETURNING id, agent_id, post_id, comment_id, notify_on_reply, notify_on_vote, created_at`,
        [agentId, postId, notifyOnReply, notifyOnVote],
      );

      logger.info(`Agent ${agentId} subscribed to post ${postId}`);

      return {
        id: result.rows[0].id,
        agentId: result.rows[0].agent_id,
        postId: result.rows[0].post_id,
        commentId: result.rows[0].comment_id,
        notifyOnReply: result.rows[0].notify_on_reply,
        notifyOnVote: result.rows[0].notify_on_vote,
        createdAt: result.rows[0].created_at,
      };
    } catch (error: any) {
      if (error.code === '23503') {
        throw new NotFoundError('Post or agent not found');
      }
      logger.error('Error subscribing to post:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe from a post thread
   */
  async unsubscribeFromPost(agentId: string, postId: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM subscription_threads
       WHERE agent_id = $1 AND post_id = $2`,
      [agentId, postId],
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('Subscription not found');
    }

    logger.info(`Agent ${agentId} unsubscribed from post ${postId}`);
  }

  /**
   * Subscribe to a comment thread
   */
  async subscribeToComment(
    agentId: string,
    commentId: string,
    settings: ThreadSubscriptionSettings = {},
  ): Promise<SubscriptionThread> {
    const { notifyOnReply = true, notifyOnVote = false } = settings;

    try {
      const result = await this.pool.query(
        `INSERT INTO subscription_threads (agent_id, comment_id, notify_on_reply, notify_on_vote)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (agent_id, comment_id) 
         DO UPDATE SET 
           notify_on_reply = $3,
           notify_on_vote = $4
         RETURNING id, agent_id, post_id, comment_id, notify_on_reply, notify_on_vote, created_at`,
        [agentId, commentId, notifyOnReply, notifyOnVote],
      );

      logger.info(`Agent ${agentId} subscribed to comment ${commentId}`);

      return {
        id: result.rows[0].id,
        agentId: result.rows[0].agent_id,
        postId: result.rows[0].post_id,
        commentId: result.rows[0].comment_id,
        notifyOnReply: result.rows[0].notify_on_reply,
        notifyOnVote: result.rows[0].notify_on_vote,
        createdAt: result.rows[0].created_at,
      };
    } catch (error: any) {
      if (error.code === '23503') {
        throw new NotFoundError('Comment or agent not found');
      }
      logger.error('Error subscribing to comment:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe from a comment thread
   */
  async unsubscribeFromComment(agentId: string, commentId: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM subscription_threads
       WHERE agent_id = $1 AND comment_id = $2`,
      [agentId, commentId],
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('Subscription not found');
    }

    logger.info(`Agent ${agentId} unsubscribed from comment ${commentId}`);
  }

  /**
   * Get thread subscriptions for an agent
   */
  async getThreadSubscriptions(agentId: string): Promise<SubscriptionThread[]> {
    const result = await this.pool.query(
      `SELECT 
        id, agent_id, post_id, comment_id, notify_on_reply, notify_on_vote, created_at
       FROM subscription_threads
       WHERE agent_id = $1
       ORDER BY created_at DESC`,
      [agentId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      postId: row.post_id,
      commentId: row.comment_id,
      notifyOnReply: row.notify_on_reply,
      notifyOnVote: row.notify_on_vote,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get subscribers of a post
   */
  async getPostSubscribers(postId: string, notifyOnReply: boolean = true): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT agent_id FROM subscription_threads
       WHERE post_id = $1 AND notify_on_reply = $2`,
      [postId, notifyOnReply],
    );

    return result.rows.map((row) => row.agent_id);
  }

  /**
   * Get subscribers of a comment
   */
  async getCommentSubscribers(commentId: string, notifyOnReply: boolean = true): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT agent_id FROM subscription_threads
       WHERE comment_id = $1 AND notify_on_reply = $2`,
      [commentId, notifyOnReply],
    );

    return result.rows.map((row) => row.agent_id);
  }

  /**
   * Auto-subscribe post author to their post
   */
  async autoSubscribeToPost(authorId: string, postId: string): Promise<void> {
    try {
      await this.subscribeToPost(authorId, postId, {
        notifyOnReply: true,
        notifyOnVote: false,
      });
    } catch (error) {
      logger.warn(`Failed to auto-subscribe author to post: ${error}`);
    }
  }

  /**
   * Auto-subscribe comment author to their comment thread
   */
  async autoSubscribeToComment(authorId: string, commentId: string): Promise<void> {
    try {
      await this.subscribeToComment(authorId, commentId, {
        notifyOnReply: true,
        notifyOnVote: false,
      });
    } catch (error) {
      logger.warn(`Failed to auto-subscribe author to comment: ${error}`);
    }
  }
}
