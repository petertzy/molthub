import { Pool } from 'pg';
import { logger } from '@config/logger';
import { NotificationService } from './notification.service';
import { SubscriptionService } from './subscription.service';
import { NotificationQueue } from './notification.queue';
import { CreateNotificationData, MAX_NOTIFICATION_CONTENT_LENGTH } from './notification.types';

/**
 * NotificationEmitter handles the creation and dispatching of notifications
 * based on various platform events
 */
export class NotificationEmitter {
  private notificationService: NotificationService;
  private subscriptionService: SubscriptionService;
  private notificationQueue?: NotificationQueue;

  constructor(pool: Pool, notificationQueue?: NotificationQueue) {
    this.notificationService = new NotificationService(pool);
    this.subscriptionService = new SubscriptionService(pool);
    this.notificationQueue = notificationQueue;
  }

  /**
   * Emit notification for a new post in a forum
   */
  async onPostCreated(
    postId: string,
    forumId: string,
    authorId: string,
    postTitle: string,
  ): Promise<void> {
    try {
      // Get forum subscribers
      const subscribers = await this.subscriptionService.getForumSubscribers(forumId, true);

      // Filter out the author (don't notify self)
      const recipients = subscribers.filter((id) => id !== authorId);

      // Create notifications for all subscribers
      const notificationPromises = recipients.map((recipientId) =>
        this.createNotificationIfEnabled(recipientId, {
          recipientId,
          senderId: authorId,
          type: 'forum_post',
          title: `New post in forum`,
          content: postTitle,
          forumId,
          postId,
          metadata: { postTitle },
        }),
      );

      await Promise.allSettled(notificationPromises);

      // Auto-subscribe the author to their post
      await this.subscriptionService.autoSubscribeToPost(authorId, postId);

      logger.info(`Created ${recipients.length} notifications for new post ${postId}`);
    } catch (error) {
      logger.error('Error emitting post created notification:', error);
    }
  }

  /**
   * Emit notification for a new comment on a post
   */
  async onCommentCreated(
    commentId: string,
    postId: string,
    forumId: string,
    authorId: string,
    commentContent: string,
    postAuthorId?: string,
    parentCommentId?: string,
  ): Promise<void> {
    try {
      const recipients = new Set<string>();

      // Get post subscribers
      const postSubscribers = await this.subscriptionService.getPostSubscribers(postId, true);
      postSubscribers.forEach((id) => {
        if (id !== authorId) recipients.add(id);
      });

      // If this is a reply to a comment, notify the parent comment author
      if (parentCommentId) {
        const commentSubscribers = await this.subscriptionService.getCommentSubscribers(
          parentCommentId,
          true,
        );
        commentSubscribers.forEach((id) => {
          if (id !== authorId) recipients.add(id);
        });

        // Create reply notification
        const replyNotifications = Array.from(recipients).map((recipientId) =>
          this.createNotificationIfEnabled(recipientId, {
            recipientId,
            senderId: authorId,
            type: 'comment_reply',
            title: 'New reply to your comment',
            content: commentContent.substring(0, MAX_NOTIFICATION_CONTENT_LENGTH),
            forumId,
            postId,
            commentId,
            metadata: { parentCommentId },
          }),
        );

        await Promise.allSettled(replyNotifications);
      } else {
        // Create comment notifications for post subscribers
        const commentNotifications = Array.from(recipients).map((recipientId) =>
          this.createNotificationIfEnabled(recipientId, {
            recipientId,
            senderId: authorId,
            type: 'post_comment',
            title: 'New comment on post',
            content: commentContent.substring(0, MAX_NOTIFICATION_CONTENT_LENGTH),
            forumId,
            postId,
            commentId,
          }),
        );

        await Promise.allSettled(commentNotifications);
      }

      // Auto-subscribe the comment author to their comment thread
      await this.subscriptionService.autoSubscribeToComment(authorId, commentId);

      logger.info(`Created ${recipients.size} notifications for comment ${commentId}`);
    } catch (error) {
      logger.error('Error emitting comment created notification:', error);
    }
  }

  /**
   * Emit notification for a vote on a post
   */
  async onPostVoted(
    postId: string,
    postAuthorId: string,
    voterId: string,
    voteType: number,
  ): Promise<void> {
    try {
      // Only notify the post author, not all subscribers
      if (postAuthorId === voterId) {
        return; // Don't notify self
      }

      // Check if author has vote notifications enabled
      await this.createNotificationIfEnabled(postAuthorId, {
        recipientId: postAuthorId,
        senderId: voterId,
        type: 'post_vote',
        title: voteType > 0 ? 'Your post received an upvote' : 'Your post received a downvote',
        postId,
        metadata: { voteType },
      });

      logger.info(`Created vote notification for post ${postId}`);
    } catch (error) {
      logger.error('Error emitting post vote notification:', error);
    }
  }

  /**
   * Emit notification for a vote on a comment
   */
  async onCommentVoted(
    commentId: string,
    postId: string,
    commentAuthorId: string,
    voterId: string,
    voteType: number,
  ): Promise<void> {
    try {
      // Only notify the comment author
      if (commentAuthorId === voterId) {
        return; // Don't notify self
      }

      // Check if author has vote notifications enabled
      await this.createNotificationIfEnabled(commentAuthorId, {
        recipientId: commentAuthorId,
        senderId: voterId,
        type: 'comment_vote',
        title:
          voteType > 0 ? 'Your comment received an upvote' : 'Your comment received a downvote',
        postId,
        commentId,
        metadata: { voteType },
      });

      logger.info(`Created vote notification for comment ${commentId}`);
    } catch (error) {
      logger.error('Error emitting comment vote notification:', error);
    }
  }

  /**
   * Create notification only if the user has it enabled
   * Uses queue if available, otherwise creates directly
   */
  private async createNotificationIfEnabled(
    recipientId: string,
    data: CreateNotificationData,
  ): Promise<void> {
    try {
      const isEnabled = await this.notificationService.isNotificationEnabled(
        recipientId,
        data.type,
      );
      if (isEnabled) {
        // Use queue if available for async processing
        if (this.notificationQueue) {
          await this.notificationQueue.queueNotification(data);
        } else {
          // Fallback to direct creation
          await this.notificationService.createNotification(data);
        }
      }
    } catch (error) {
      logger.warn(`Failed to create notification for agent ${recipientId}:`, error);
    }
  }
}
