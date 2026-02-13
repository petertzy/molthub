import { Pool } from 'pg';
import * as crypto from 'crypto';
import { logger } from '@config/logger';
import {
  AuditLogEntry,
  AuditLogQuery,
  AuditLogStats,
  AuditStatus,
  SensitiveFieldConfig,
  AuditRetentionPolicy,
} from './audit.types';

/**
 * Sensitive fields that should be masked in audit logs
 */
const SENSITIVE_FIELDS: SensitiveFieldConfig[] = [
  { field: 'password', maskType: 'redact' },
  { field: 'api_key', maskType: 'redact' },
  { field: 'api_secret', maskType: 'redact' },
  { field: 'token', maskType: 'redact' },
  { field: 'refresh_token', maskType: 'redact' },
  { field: 'email', maskType: 'partial', partialRevealChars: 3 },
  { field: 'ip_address', maskType: 'partial', partialRevealChars: 7 },
];

/**
 * Default retention policy: 365 days (1 year)
 */
const DEFAULT_RETENTION_POLICY: AuditRetentionPolicy = {
  retention_days: 365,
  archive_enabled: false,
};

/**
 * Audit Service for logging and querying audit events
 */
export class AuditService {
  private pool: Pool;
  private encryptionKey: Buffer;
  private retentionPolicy: AuditRetentionPolicy;

  constructor(pool: Pool, encryptionKey?: string) {
    this.pool = pool;
    // Use provided key or generate from environment
    const key = encryptionKey || process.env.AUDIT_ENCRYPTION_KEY || 'default-key-change-in-prod';
    this.encryptionKey = crypto.scryptSync(key, 'salt', 32);
    this.retentionPolicy = DEFAULT_RETENTION_POLICY;
  }

  /**
   * Encrypt sensitive data
   */
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt sensitive data
   */
  private decrypt(text: string): string {
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift()!, 'hex');
    const encryptedText = parts.join(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Mask sensitive information based on field configuration
   */
  private maskSensitiveData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const masked = Array.isArray(data) ? [...data] : { ...data };

    for (const config of SENSITIVE_FIELDS) {
      if (config.field in masked) {
        const value = masked[config.field];
        if (typeof value === 'string') {
          switch (config.maskType) {
            case 'redact':
              masked[config.field] = '[REDACTED]';
              break;
            case 'hash':
              masked[config.field] = crypto
                .createHash('sha256')
                .update(value)
                .digest('hex')
                .substring(0, 16);
              break;
            case 'partial':
              const revealChars = config.partialRevealChars || 3;
              if (value.length > revealChars) {
                masked[config.field] = value.substring(0, revealChars) + '***';
              }
              break;
          }
        }
      }
    }

    // Recursively mask nested objects
    for (const key in masked) {
      if (typeof masked[key] === 'object' && masked[key] !== null) {
        masked[key] = this.maskSensitiveData(masked[key]);
      }
    }

    return masked;
  }

  /**
   * Log an audit event
   */
  async log(entry: AuditLogEntry): Promise<string> {
    try {
      // Mask sensitive data in details
      const maskedDetails = this.maskSensitiveData(entry.details || {});

      // Encrypt sensitive details if they contain critical information
      const detailsJson = JSON.stringify(maskedDetails);
      const encryptedDetails =
        maskedDetails && Object.keys(maskedDetails).length > 0
          ? this.encrypt(detailsJson)
          : null;

      const query = `
        INSERT INTO audit_logs (
          agent_id, action, resource_type, resource_id, 
          status, ip_address, user_agent, details
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `;

      const values = [
        entry.agent_id || null,
        entry.action,
        entry.resource_type || null,
        entry.resource_id || null,
        entry.status,
        entry.ip_address || null,
        entry.user_agent || null,
        encryptedDetails,
      ];

      const result = await this.pool.query(query, values);

      logger.debug('Audit log created', {
        id: result.rows[0].id,
        action: entry.action,
        agent_id: entry.agent_id,
      });

      return result.rows[0].id;
    } catch (error) {
      // Don't throw error for audit logging to prevent breaking application flow
      logger.error('Failed to create audit log', { error, entry });
      return '';
    }
  }

  /**
   * Query audit logs with filters
   */
  async query(filters: AuditLogQuery): Promise<AuditLogEntry[]> {
    try {
      const conditions: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (filters.agent_id) {
        conditions.push(`agent_id = $${paramCount++}`);
        values.push(filters.agent_id);
      }

      if (filters.action) {
        conditions.push(`action = $${paramCount++}`);
        values.push(filters.action);
      }

      if (filters.resource_type) {
        conditions.push(`resource_type = $${paramCount++}`);
        values.push(filters.resource_type);
      }

      if (filters.resource_id) {
        conditions.push(`resource_id = $${paramCount++}`);
        values.push(filters.resource_id);
      }

      if (filters.status) {
        conditions.push(`status = $${paramCount++}`);
        values.push(filters.status);
      }

      if (filters.start_date) {
        conditions.push(`created_at >= $${paramCount++}`);
        values.push(filters.start_date);
      }

      if (filters.end_date) {
        conditions.push(`created_at <= $${paramCount++}`);
        values.push(filters.end_date);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = filters.limit || 100;
      const offset = filters.offset || 0;

      const query = `
        SELECT 
          id, agent_id, action, resource_type, resource_id,
          status, ip_address, user_agent, details, created_at
        FROM audit_logs
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${paramCount++} OFFSET $${paramCount++}
      `;

      values.push(limit, offset);

      const result = await this.pool.query(query, values);

      // Decrypt and return logs
      return result.rows.map((row) => ({
        ...row,
        details:
          row.details && row.details !== '[REDACTED]'
            ? JSON.parse(this.decrypt(row.details))
            : {},
      }));
    } catch (error) {
      logger.error('Failed to query audit logs', { error, filters });
      throw error;
    }
  }

  /**
   * Get audit log statistics
   */
  async getStats(
    start_date?: Date,
    end_date?: Date,
  ): Promise<AuditLogStats> {
    try {
      const conditions: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (start_date) {
        conditions.push(`created_at >= $${paramCount++}`);
        values.push(start_date);
      }

      if (end_date) {
        conditions.push(`created_at <= $${paramCount++}`);
        values.push(end_date);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Get overall counts
      const countQuery = `
        SELECT 
          COUNT(*) as total_logs,
          COUNT(*) FILTER (WHERE status = 'success') as success_count,
          COUNT(*) FILTER (WHERE status = 'failure') as failure_count,
          COUNT(*) FILTER (WHERE status = 'warning') as warning_count
        FROM audit_logs
        ${whereClause}
      `;

      const countResult = await this.pool.query(countQuery, values);

      // Get actions breakdown
      const actionsQuery = `
        SELECT action, COUNT(*) as count
        FROM audit_logs
        ${whereClause}
        GROUP BY action
        ORDER BY count DESC
      `;

      const actionsResult = await this.pool.query(actionsQuery, values);

      // Get top agents
      const agentsQuery = `
        SELECT agent_id, COUNT(*) as action_count
        FROM audit_logs
        ${whereClause}
        AND agent_id IS NOT NULL
        GROUP BY agent_id
        ORDER BY action_count DESC
        LIMIT 10
      `;

      const agentsResult = await this.pool.query(agentsQuery, values);

      const actions_breakdown: Record<string, number> = {};
      actionsResult.rows.forEach((row) => {
        actions_breakdown[row.action] = parseInt(row.count, 10);
      });

      return {
        total_logs: parseInt(countResult.rows[0].total_logs, 10),
        success_count: parseInt(countResult.rows[0].success_count, 10),
        failure_count: parseInt(countResult.rows[0].failure_count, 10),
        warning_count: parseInt(countResult.rows[0].warning_count, 10),
        actions_breakdown,
        top_agents: agentsResult.rows.map((row) => ({
          agent_id: row.agent_id,
          action_count: parseInt(row.action_count, 10),
        })),
      };
    } catch (error) {
      logger.error('Failed to get audit stats', { error });
      throw error;
    }
  }

  /**
   * Apply retention policy - delete old logs
   */
  async applyRetentionPolicy(): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionPolicy.retention_days);

      const query = `
        DELETE FROM audit_logs
        WHERE created_at < $1
      `;

      const result = await this.pool.query(query, [cutoffDate]);

      logger.info('Audit retention policy applied', {
        deleted_count: result.rowCount,
        cutoff_date: cutoffDate,
      });

      return result.rowCount || 0;
    } catch (error) {
      logger.error('Failed to apply retention policy', { error });
      throw error;
    }
  }

  /**
   * Update retention policy
   */
  setRetentionPolicy(policy: AuditRetentionPolicy): void {
    this.retentionPolicy = policy;
    logger.info('Audit retention policy updated', { policy });
  }

  /**
   * Generate audit report for a time period
   */
  async generateReport(start_date: Date, end_date: Date): Promise<any> {
    try {
      const stats = await this.getStats(start_date, end_date);
      const logs = await this.query({ start_date, end_date, limit: 1000 });

      // Group logs by agent
      const agentActivity: Record<string, any> = {};
      logs.forEach((log) => {
        if (log.agent_id) {
          if (!agentActivity[log.agent_id]) {
            agentActivity[log.agent_id] = {
              agent_id: log.agent_id,
              actions: {},
              total_actions: 0,
              failures: 0,
            };
          }

          agentActivity[log.agent_id].total_actions++;
          agentActivity[log.agent_id].actions[log.action] =
            (agentActivity[log.agent_id].actions[log.action] || 0) + 1;

          if (log.status === AuditStatus.FAILURE) {
            agentActivity[log.agent_id].failures++;
          }
        }
      });

      return {
        period: {
          start_date,
          end_date,
        },
        summary: stats,
        agent_activity: Object.values(agentActivity),
        recent_failures: logs
          .filter((log) => log.status === AuditStatus.FAILURE)
          .slice(0, 20),
      };
    } catch (error) {
      logger.error('Failed to generate audit report', { error });
      throw error;
    }
  }

  /**
   * Export logs for compliance/archival
   */
  async exportLogs(
    filters: AuditLogQuery,
    format: 'json' | 'csv' = 'json',
  ): Promise<string> {
    try {
      const logs = await this.query(filters);

      if (format === 'json') {
        return JSON.stringify(logs, null, 2);
      } else {
        // CSV format
        const headers = [
          'id',
          'agent_id',
          'action',
          'resource_type',
          'resource_id',
          'status',
          'ip_address',
          'created_at',
        ];
        const csvLines = [headers.join(',')];

        logs.forEach((log) => {
          const values = headers.map((header) => {
            const value = log[header as keyof AuditLogEntry];
            return value ? `"${value}"` : '';
          });
          csvLines.push(values.join(','));
        });

        return csvLines.join('\n');
      }
    } catch (error) {
      logger.error('Failed to export logs', { error });
      throw error;
    }
  }
}
