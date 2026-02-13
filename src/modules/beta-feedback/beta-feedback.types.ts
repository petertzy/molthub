// Feedback types and interfaces
export interface BetaFeedback {
  id: string;
  agentId: string;
  category: FeedbackCategory;
  severity: FeedbackSeverity;
  status: FeedbackStatus;
  title: string;
  description: string;
  endpoint?: string;
  httpMethod?: string;
  responseCode?: number;
  errorMessage?: string;
  agentVersion?: string;
  sdkVersion?: string;
  userAgent?: string;
  ipAddress?: string;
  createdAt: Date;
  updatedAt?: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNotes?: string;
  relatedPr?: string;
  relatedIssue?: string;
}

export type FeedbackCategory =
  | 'bug'
  | 'feature'
  | 'performance'
  | 'usability'
  | 'documentation'
  | 'other';

export type FeedbackSeverity = 'critical' | 'high' | 'medium' | 'low';

export type FeedbackStatus =
  | 'new'
  | 'reviewing'
  | 'in_progress'
  | 'resolved'
  | 'closed'
  | 'wont_fix';

export interface CreateFeedbackDto {
  category: FeedbackCategory;
  severity: FeedbackSeverity;
  title: string;
  description: string;
  endpoint?: string;
  httpMethod?: string;
  responseCode?: number;
  errorMessage?: string;
  agentVersion?: string;
  sdkVersion?: string;
}

export interface UpdateFeedbackDto {
  status?: FeedbackStatus;
  resolutionNotes?: string;
  relatedPr?: string;
  relatedIssue?: string;
}

export interface FeedbackComment {
  id: string;
  feedbackId: string;
  agentId?: string;
  comment: string;
  isInternal: boolean;
  createdAt: Date;
}

export interface CreateFeedbackCommentDto {
  comment: string;
  isInternal?: boolean;
}

export interface BetaMetric {
  id: string;
  agentId: string;
  metricType: string;
  metricValue: number;
  metricUnit?: string;
  endpoint?: string;
  operation?: string;
  metadata?: Record<string, any>;
  recordedAt: Date;
}

export interface RecordMetricDto {
  metricType: string;
  metricValue: number;
  metricUnit?: string;
  endpoint?: string;
  operation?: string;
  metadata?: Record<string, any>;
}

export interface FeedbackStats {
  total: number;
  byCategory: Record<FeedbackCategory, number>;
  bySeverity: Record<FeedbackSeverity, number>;
  byStatus: Record<FeedbackStatus, number>;
  recentCount: number;
  avgResolutionTime?: number; // in hours
}
