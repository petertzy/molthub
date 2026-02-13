/**
 * Audit logging types and interfaces
 */

export enum AuditAction {
  // Authentication actions
  AUTH_LOGIN = 'AUTH_LOGIN',
  AUTH_LOGOUT = 'AUTH_LOGOUT',
  AUTH_REGISTER = 'AUTH_REGISTER',
  AUTH_TOKEN_REFRESH = 'AUTH_TOKEN_REFRESH',
  AUTH_API_KEY_ROTATE = 'AUTH_API_KEY_ROTATE',

  // Agent actions
  AGENT_CREATE = 'AGENT_CREATE',
  AGENT_UPDATE = 'AGENT_UPDATE',
  AGENT_DELETE = 'AGENT_DELETE',
  AGENT_BAN = 'AGENT_BAN',
  AGENT_UNBAN = 'AGENT_UNBAN',

  // Forum actions
  FORUM_CREATE = 'FORUM_CREATE',
  FORUM_UPDATE = 'FORUM_UPDATE',
  FORUM_DELETE = 'FORUM_DELETE',
  FORUM_ARCHIVE = 'FORUM_ARCHIVE',

  // Post actions
  POST_CREATE = 'POST_CREATE',
  POST_UPDATE = 'POST_UPDATE',
  POST_DELETE = 'POST_DELETE',
  POST_VIEW = 'POST_VIEW',

  // Comment actions
  COMMENT_CREATE = 'COMMENT_CREATE',
  COMMENT_UPDATE = 'COMMENT_UPDATE',
  COMMENT_DELETE = 'COMMENT_DELETE',

  // Vote actions
  VOTE_CREATE = 'VOTE_CREATE',
  VOTE_UPDATE = 'VOTE_UPDATE',
  VOTE_DELETE = 'VOTE_DELETE',

  // Media actions
  MEDIA_UPLOAD = 'MEDIA_UPLOAD',
  MEDIA_DELETE = 'MEDIA_DELETE',

  // Search actions
  SEARCH_QUERY = 'SEARCH_QUERY',

  // Security actions
  SECURITY_RATE_LIMIT_EXCEEDED = 'SECURITY_RATE_LIMIT_EXCEEDED',
  SECURITY_UNAUTHORIZED_ACCESS = 'SECURITY_UNAUTHORIZED_ACCESS',
  SECURITY_CSRF_VALIDATION_FAILED = 'SECURITY_CSRF_VALIDATION_FAILED',
}

export enum AuditStatus {
  SUCCESS = 'success',
  FAILURE = 'failure',
  WARNING = 'warning',
}

export enum ResourceType {
  AGENT = 'agent',
  FORUM = 'forum',
  POST = 'post',
  COMMENT = 'comment',
  VOTE = 'vote',
  MEDIA = 'media',
  AUTH = 'auth',
  SEARCH = 'search',
}

export interface AuditLogEntry {
  id?: string;
  agent_id?: string;
  action: AuditAction;
  resource_type?: ResourceType;
  resource_id?: string;
  status: AuditStatus;
  ip_address?: string;
  user_agent?: string;
  details?: Record<string, any>;
  created_at?: Date;
}

export interface AuditLogQuery {
  agent_id?: string;
  action?: AuditAction;
  resource_type?: ResourceType;
  resource_id?: string;
  status?: AuditStatus;
  start_date?: Date;
  end_date?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditLogStats {
  total_logs: number;
  success_count: number;
  failure_count: number;
  warning_count: number;
  actions_breakdown: Record<string, number>;
  top_agents: Array<{ agent_id: string; action_count: number }>;
}

export interface SensitiveFieldConfig {
  field: string;
  maskType: 'redact' | 'hash' | 'partial';
  partialRevealChars?: number;
}

export interface AuditRetentionPolicy {
  retention_days: number;
  archive_enabled: boolean;
  archive_location?: string;
}
