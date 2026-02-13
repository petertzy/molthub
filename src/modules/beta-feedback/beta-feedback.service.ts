import { Pool } from 'pg';
import { logger } from '@config/logger';
import {
  BetaFeedback,
  CreateFeedbackDto,
  UpdateFeedbackDto,
  FeedbackComment,
  CreateFeedbackCommentDto,
  BetaMetric,
  RecordMetricDto,
  FeedbackStats,
  FeedbackStatus,
  FeedbackSeverity,
  FeedbackCategory,
} from './beta-feedback.types';

export class BetaFeedbackService {
  constructor(
    private pool: Pool,
    private logger: any
  ) {}

  /**
   * Create new feedback
   */
  async createFeedback(
    agentId: string,
    data: CreateFeedbackDto,
    ipAddress?: string,
    userAgent?: string
  ): Promise<BetaFeedback> {
    this.logger.info('Creating beta feedback', { agentId, category: data.category });

    const query = `
      INSERT INTO beta_feedback (
        agent_id, category, severity, title, description,
        endpoint, http_method, response_code, error_message,
        agent_version, sdk_version, user_agent, ip_address
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;

    const values = [
      agentId,
      data.category,
      data.severity,
      data.title,
      data.description,
      data.endpoint,
      data.httpMethod,
      data.responseCode,
      data.errorMessage,
      data.agentVersion,
      data.sdkVersion,
      userAgent,
      ipAddress,
    ];

    try {
      const result = await this.pool.query(query, values);
      return this.mapRowToFeedback(result.rows[0]);
    } catch (error) {
      this.logger.error('Failed to create feedback', { error, agentId });
      throw error;
    }
  }

  /**
   * Get feedback by ID
   */
  async getFeedbackById(feedbackId: string, agentId?: string): Promise<BetaFeedback | null> {
    let query = `
      SELECT * FROM beta_feedback
      WHERE id = $1
    `;
    const values: any[] = [feedbackId];

    // Allow agents to only see their own feedback unless no agent specified (admin view)
    if (agentId) {
      query += ` AND agent_id = $2`;
      values.push(agentId);
    }

    try {
      const result = await this.pool.query(query, values);
      return result.rows[0] ? this.mapRowToFeedback(result.rows[0]) : null;
    } catch (error) {
      this.logger.error('Failed to get feedback', { error, feedbackId });
      throw error;
    }
  }

  /**
   * List feedback with filters
   */
  async listFeedback(options: {
    agentId?: string;
    category?: FeedbackCategory;
    severity?: FeedbackSeverity;
    status?: FeedbackStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ feedback: BetaFeedback[]; total: number }> {
    const { agentId, category, severity, status, limit = 50, offset = 0 } = options;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramCount = 0;

    if (agentId) {
      paramCount++;
      conditions.push(`agent_id = $${paramCount}`);
      values.push(agentId);
    }

    if (category) {
      paramCount++;
      conditions.push(`category = $${paramCount}`);
      values.push(category);
    }

    if (severity) {
      paramCount++;
      conditions.push(`severity = $${paramCount}`);
      values.push(severity);
    }

    if (status) {
      paramCount++;
      conditions.push(`status = $${paramCount}`);
      values.push(status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM beta_feedback ${whereClause}`;
    const countResult = await this.pool.query(countQuery, values);
    const total = parseInt(countResult.rows[0].count);

    // Get feedback
    const query = `
      SELECT * FROM beta_feedback
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;
    values.push(limit, offset);

    try {
      const result = await this.pool.query(query, values);
      const feedback = result.rows.map((row) => this.mapRowToFeedback(row));
      return { feedback, total };
    } catch (error) {
      this.logger.error('Failed to list feedback', { error, options });
      throw error;
    }
  }

  /**
   * Update feedback (typically for status changes, resolution)
   */
  async updateFeedback(
    feedbackId: string,
    data: UpdateFeedbackDto,
    resolvedBy?: string
  ): Promise<BetaFeedback> {
    this.logger.info('Updating feedback', { feedbackId, updates: data });

    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 0;

    if (data.status !== undefined) {
      paramCount++;
      updates.push(`status = $${paramCount}`);
      values.push(data.status);

      // Set resolved_at if status is resolved
      if (data.status === 'resolved' || data.status === 'closed') {
        paramCount++;
        updates.push(`resolved_at = $${paramCount}`);
        values.push(new Date());

        if (resolvedBy) {
          paramCount++;
          updates.push(`resolved_by = $${paramCount}`);
          values.push(resolvedBy);
        }
      }
    }

    if (data.resolutionNotes !== undefined) {
      paramCount++;
      updates.push(`resolution_notes = $${paramCount}`);
      values.push(data.resolutionNotes);
    }

    if (data.relatedPr !== undefined) {
      paramCount++;
      updates.push(`related_pr = $${paramCount}`);
      values.push(data.relatedPr);
    }

    if (data.relatedIssue !== undefined) {
      paramCount++;
      updates.push(`related_issue = $${paramCount}`);
      values.push(data.relatedIssue);
    }

    if (updates.length === 0) {
      throw new Error('No updates provided');
    }

    const query = `
      UPDATE beta_feedback
      SET ${updates.join(', ')}
      WHERE id = $${paramCount + 1}
      RETURNING *
    `;
    values.push(feedbackId);

    try {
      const result = await this.pool.query(query, values);
      if (result.rows.length === 0) {
        throw new Error('Feedback not found');
      }
      return this.mapRowToFeedback(result.rows[0]);
    } catch (error) {
      this.logger.error('Failed to update feedback', { error, feedbackId });
      throw error;
    }
  }

  /**
   * Add comment to feedback
   */
  async addComment(
    feedbackId: string,
    agentId: string,
    data: CreateFeedbackCommentDto
  ): Promise<FeedbackComment> {
    const query = `
      INSERT INTO beta_feedback_comments (feedback_id, agent_id, comment, is_internal)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    const values = [feedbackId, agentId, data.comment, data.isInternal || false];

    try {
      const result = await this.pool.query(query, values);
      return this.mapRowToComment(result.rows[0]);
    } catch (error) {
      this.logger.error('Failed to add comment', { error, feedbackId });
      throw error;
    }
  }

  /**
   * Get comments for feedback
   */
  async getComments(feedbackId: string, includeInternal = false): Promise<FeedbackComment[]> {
    let query = `
      SELECT * FROM beta_feedback_comments
      WHERE feedback_id = $1
    `;

    if (!includeInternal) {
      query += ` AND is_internal = false`;
    }

    query += ` ORDER BY created_at ASC`;

    try {
      const result = await this.pool.query(query, [feedbackId]);
      return result.rows.map((row) => this.mapRowToComment(row));
    } catch (error) {
      this.logger.error('Failed to get comments', { error, feedbackId });
      throw error;
    }
  }

  /**
   * Record a metric
   */
  async recordMetric(agentId: string, data: RecordMetricDto): Promise<BetaMetric> {
    const query = `
      INSERT INTO beta_metrics (
        agent_id, metric_type, metric_value, metric_unit,
        endpoint, operation, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const values = [
      agentId,
      data.metricType,
      data.metricValue,
      data.metricUnit,
      data.endpoint,
      data.operation,
      data.metadata ? JSON.stringify(data.metadata) : null,
    ];

    try {
      const result = await this.pool.query(query, values);
      return this.mapRowToMetric(result.rows[0]);
    } catch (error) {
      this.logger.error('Failed to record metric', { error, agentId });
      throw error;
    }
  }

  /**
   * Get feedback statistics
   */
  async getStats(agentId?: string): Promise<FeedbackStats> {
    let whereClause = '';
    const values: any[] = [];

    if (agentId) {
      whereClause = 'WHERE agent_id = $1';
      values.push(agentId);
    }

    const query = `
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN category = 'bug' THEN 1 END) as bug_count,
        COUNT(CASE WHEN category = 'feature' THEN 1 END) as feature_count,
        COUNT(CASE WHEN category = 'performance' THEN 1 END) as performance_count,
        COUNT(CASE WHEN category = 'usability' THEN 1 END) as usability_count,
        COUNT(CASE WHEN category = 'documentation' THEN 1 END) as documentation_count,
        COUNT(CASE WHEN category = 'other' THEN 1 END) as other_count,
        COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count,
        COUNT(CASE WHEN severity = 'high' THEN 1 END) as high_count,
        COUNT(CASE WHEN severity = 'medium' THEN 1 END) as medium_count,
        COUNT(CASE WHEN severity = 'low' THEN 1 END) as low_count,
        COUNT(CASE WHEN status = 'new' THEN 1 END) as new_count,
        COUNT(CASE WHEN status = 'reviewing' THEN 1 END) as reviewing_count,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_count,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_count,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_count,
        COUNT(CASE WHEN status = 'wont_fix' THEN 1 END) as wont_fix_count,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as recent_count,
        AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) FILTER (WHERE resolved_at IS NOT NULL) as avg_resolution_hours
      FROM beta_feedback
      ${whereClause}
    `;

    try {
      const result = await this.pool.query(query, values);
      const row = result.rows[0];

      return {
        total: parseInt(row.total),
        byCategory: {
          bug: parseInt(row.bug_count),
          feature: parseInt(row.feature_count),
          performance: parseInt(row.performance_count),
          usability: parseInt(row.usability_count),
          documentation: parseInt(row.documentation_count),
          other: parseInt(row.other_count),
        },
        bySeverity: {
          critical: parseInt(row.critical_count),
          high: parseInt(row.high_count),
          medium: parseInt(row.medium_count),
          low: parseInt(row.low_count),
        },
        byStatus: {
          new: parseInt(row.new_count),
          reviewing: parseInt(row.reviewing_count),
          in_progress: parseInt(row.in_progress_count),
          resolved: parseInt(row.resolved_count),
          closed: parseInt(row.closed_count),
          wont_fix: parseInt(row.wont_fix_count),
        },
        recentCount: parseInt(row.recent_count),
        avgResolutionTime: row.avg_resolution_hours ? parseFloat(row.avg_resolution_hours) : undefined,
      };
    } catch (error) {
      this.logger.error('Failed to get stats', { error, agentId });
      throw error;
    }
  }

  /**
   * Delete feedback (admin only)
   */
  async deleteFeedback(feedbackId: string): Promise<void> {
    const query = 'DELETE FROM beta_feedback WHERE id = $1';
    try {
      await this.pool.query(query, [feedbackId]);
    } catch (error) {
      this.logger.error('Failed to delete feedback', { error, feedbackId });
      throw error;
    }
  }

  // Helper methods
  private mapRowToFeedback(row: any): BetaFeedback {
    return {
      id: row.id,
      agentId: row.agent_id,
      category: row.category,
      severity: row.severity,
      status: row.status,
      title: row.title,
      description: row.description,
      endpoint: row.endpoint,
      httpMethod: row.http_method,
      responseCode: row.response_code,
      errorMessage: row.error_message,
      agentVersion: row.agent_version,
      sdkVersion: row.sdk_version,
      userAgent: row.user_agent,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      resolutionNotes: row.resolution_notes,
      relatedPr: row.related_pr,
      relatedIssue: row.related_issue,
    };
  }

  private mapRowToComment(row: any): FeedbackComment {
    return {
      id: row.id,
      feedbackId: row.feedback_id,
      agentId: row.agent_id,
      comment: row.comment,
      isInternal: row.is_internal,
      createdAt: row.created_at,
    };
  }

  private mapRowToMetric(row: any): BetaMetric {
    return {
      id: row.id,
      agentId: row.agent_id,
      metricType: row.metric_type,
      metricValue: parseFloat(row.metric_value),
      metricUnit: row.metric_unit,
      endpoint: row.endpoint,
      operation: row.operation,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      recordedAt: row.recorded_at,
    };
  }
}
