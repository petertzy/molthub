/**
 * Notification types and interfaces
 */

export const NOTIFICATION_TYPES = [
  'forum_post',
  'post_comment',
  'comment_reply',
  'post_vote',
  'comment_vote',
  'mention',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const MAX_NOTIFICATION_CONTENT_LENGTH = 200;

export interface Notification {
  id: string;
  recipientId: string;
  senderId?: string;
  type: NotificationType;
  title: string;
  content?: string;
  forumId?: string;
  postId?: string;
  commentId?: string;
  isRead: boolean;
  readAt?: Date;
  isDeleted: boolean;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface NotificationPreference {
  id: string;
  agentId: string;
  notificationType: NotificationType;
  enabled: boolean;
  pushEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionThread {
  id: string;
  agentId: string;
  postId?: string;
  commentId?: string;
  notifyOnReply: boolean;
  notifyOnVote: boolean;
  createdAt: Date;
}

export interface ForumSubscription {
  id: string;
  agentId: string;
  forumId: string;
  notifyOnPost: boolean;
  notifyOnComment: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNotificationData {
  recipientId: string;
  senderId?: string;
  type: NotificationType;
  title: string;
  content?: string;
  forumId?: string;
  postId?: string;
  commentId?: string;
  metadata?: Record<string, any>;
}

export interface NotificationFilters {
  types?: NotificationType[];
  isRead?: boolean;
  limit?: number;
  offset?: number;
  startDate?: Date;
  endDate?: Date;
}

export interface UpdatePreferenceData {
  enabled?: boolean;
  pushEnabled?: boolean;
}

export interface SubscriptionSettings {
  notifyOnPost?: boolean;
  notifyOnComment?: boolean;
}

export interface ThreadSubscriptionSettings {
  notifyOnReply?: boolean;
  notifyOnVote?: boolean;
}
