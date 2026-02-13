import { Pool } from 'pg';
import { logger } from '@config/logger';
import { NotFoundError, ValidationError } from '@shared/middleware/error.middleware';
import {
  Notification,
  NotificationPreference,
  CreateNotificationData,
  NotificationFilters,
  UpdatePreferenceData,
  NotificationType,
  NOTIFICATION_TYPES,
} from './notification.types';

export class NotificationService {
  constructor(private pool: Pool) {}

  /**
   * Create a new notification
   */
  async createNotification(data: CreateNotificationData): Promise<Notification> {
    // Validate that at least one resource reference exists
    if (!data.forumId && !data.postId && !data.commentId) {
      throw new ValidationError(
        'At least one resource reference (forumId, postId, commentId) is required',
      );
    }

    // Validate notification type
    if (!NOTIFICATION_TYPES.includes(data.type)) {
      throw new ValidationError(`Invalid notification type: ${data.type}`);
    }

    try {
      const result = await this.pool.query(
        `INSERT INTO notifications 
         (recipient_id, sender_id, type, title, content, forum_id, post_id, comment_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING 
           id, recipient_id, sender_id, type, title, content, 
           forum_id, post_id, comment_id, is_read, read_at, 
           is_deleted, metadata, created_at`,
        [
          data.recipientId,
          data.senderId || null,
          data.type,
          data.title,
          data.content || null,
          data.forumId || null,
          data.postId || null,
          data.commentId || null,
          JSON.stringify(data.metadata || {}),
        ],
      );

      const row = result.rows[0];
      logger.info(`Notification created: ${row.id} for agent ${data.recipientId}`);

      return this.mapRowToNotification(row);
    } catch (error: any) {
      logger.error('Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Get notifications for an agent
   */
  async getNotifications(
    agentId: string,
    filters: NotificationFilters = {},
  ): Promise<Notification[]> {
    const { types, isRead, limit = 50, offset = 0, startDate, endDate } = filters;

    let query = `
      SELECT 
        id, recipient_id, sender_id, type, title, content,
        forum_id, post_id, comment_id, is_read, read_at,
        is_deleted, metadata, created_at
      FROM notifications
      WHERE recipient_id = $1 AND is_deleted = false
    `;
    const params: any[] = [agentId];
    let paramIndex = 2;

    // Filter by notification types
    if (types && types.length > 0) {
      query += ` AND type = ANY($${paramIndex})`;
      params.push(types);
      paramIndex++;
    }

    // Filter by read status
    if (isRead !== undefined) {
      query += ` AND is_read = $${paramIndex}`;
      params.push(isRead);
      paramIndex++;
    }

    // Filter by date range
    if (startDate) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    // Order and pagination
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => this.mapRowToNotification(row));
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(agentId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*) as count 
       FROM notifications 
       WHERE recipient_id = $1 AND is_read = false AND is_deleted = false`,
      [agentId],
    );
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, agentId: string): Promise<Notification> {
    const result = await this.pool.query(
      `UPDATE notifications 
       SET is_read = true, read_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND recipient_id = $2
       RETURNING 
         id, recipient_id, sender_id, type, title, content,
         forum_id, post_id, comment_id, is_read, read_at,
         is_deleted, metadata, created_at`,
      [notificationId, agentId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Notification not found');
    }

    return this.mapRowToNotification(result.rows[0]);
  }

  /**
   * Mark notification as unread
   */
  async markAsUnread(notificationId: string, agentId: string): Promise<Notification> {
    const result = await this.pool.query(
      `UPDATE notifications 
       SET is_read = false, read_at = NULL
       WHERE id = $1 AND recipient_id = $2
       RETURNING 
         id, recipient_id, sender_id, type, title, content,
         forum_id, post_id, comment_id, is_read, read_at,
         is_deleted, metadata, created_at`,
      [notificationId, agentId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Notification not found');
    }

    return this.mapRowToNotification(result.rows[0]);
  }

  /**
   * Mark all notifications as read for an agent
   */
  async markAllAsRead(agentId: string): Promise<number> {
    const result = await this.pool.query(
      `UPDATE notifications 
       SET is_read = true, read_at = CURRENT_TIMESTAMP
       WHERE recipient_id = $1 AND is_read = false AND is_deleted = false`,
      [agentId],
    );

    logger.info(`Marked ${result.rowCount} notifications as read for agent ${agentId}`);
    return result.rowCount || 0;
  }

  /**
   * Delete notification (soft delete)
   */
  async deleteNotification(notificationId: string, agentId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE notifications 
       SET is_deleted = true
       WHERE id = $1 AND recipient_id = $2`,
      [notificationId, agentId],
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('Notification not found');
    }

    logger.info(`Notification ${notificationId} deleted by agent ${agentId}`);
  }

  /**
   * Get notification preferences for an agent
   */
  async getPreferences(agentId: string): Promise<NotificationPreference[]> {
    const result = await this.pool.query(
      `SELECT 
        id, agent_id, notification_type, enabled, push_enabled,
        created_at, updated_at
       FROM notification_preferences
       WHERE agent_id = $1
       ORDER BY notification_type`,
      [agentId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      notificationType: row.notification_type,
      enabled: row.enabled,
      pushEnabled: row.push_enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Update notification preference
   */
  async updatePreference(
    agentId: string,
    notificationType: NotificationType,
    data: UpdatePreferenceData,
  ): Promise<NotificationPreference> {
    // First, try to insert or update
    const result = await this.pool.query(
      `INSERT INTO notification_preferences (agent_id, notification_type, enabled, push_enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (agent_id, notification_type) 
       DO UPDATE SET 
         enabled = COALESCE($3, notification_preferences.enabled),
         push_enabled = COALESCE($4, notification_preferences.push_enabled),
         updated_at = CURRENT_TIMESTAMP
       RETURNING 
         id, agent_id, notification_type, enabled, push_enabled,
         created_at, updated_at`,
      [agentId, notificationType, data.enabled ?? null, data.pushEnabled ?? null],
    );

    return {
      id: result.rows[0].id,
      agentId: result.rows[0].agent_id,
      notificationType: result.rows[0].notification_type,
      enabled: result.rows[0].enabled,
      pushEnabled: result.rows[0].push_enabled,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
    };
  }

  /**
   * Check if agent has notifications enabled for a specific type
   */
  async isNotificationEnabled(
    agentId: string,
    notificationType: NotificationType,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT enabled FROM notification_preferences
       WHERE agent_id = $1 AND notification_type = $2`,
      [agentId, notificationType],
    );

    // Default to enabled if no preference is set
    return result.rows.length === 0 ? true : result.rows[0].enabled;
  }

  /**
   * Helper method to map database row to Notification object
   */
  private mapRowToNotification(row: any): Notification {
    return {
      id: row.id,
      recipientId: row.recipient_id,
      senderId: row.sender_id,
      type: row.type,
      title: row.title,
      content: row.content,
      forumId: row.forum_id,
      postId: row.post_id,
      commentId: row.comment_id,
      isRead: row.is_read,
      readAt: row.read_at,
      isDeleted: row.is_deleted,
      metadata: row.metadata,
      createdAt: row.created_at,
    };
  }
}
