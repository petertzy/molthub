import { Request, Response, Router } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import { AuditService } from './audit.service';
import { AuditAction, AuditStatus, ResourceType } from './audit.types';
import { authMiddleware } from '@shared/middleware/auth.middleware';
import { logger } from '@config/logger';

/**
 * Validation schemas
 */
const querySchema = z.object({
  agent_id: z.string().uuid().optional(),
  action: z.nativeEnum(AuditAction).optional(),
  resource_type: z.nativeEnum(ResourceType).optional(),
  resource_id: z.string().uuid().optional(),
  status: z.nativeEnum(AuditStatus).optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(1000).optional(),
  offset: z.coerce.number().min(0).optional(),
});

const statsSchema = z.object({
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
});

const exportSchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
  agent_id: z.string().uuid().optional(),
  action: z.nativeEnum(AuditAction).optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
});

const reportSchema = z.object({
  start_date: z.string().datetime(),
  end_date: z.string().datetime(),
});

/**
 * Audit Controller - handles HTTP requests for audit logs
 */
export class AuditController {
  private auditService: AuditService;
  public router: Router;

  constructor(pool: Pool) {
    this.auditService = new AuditService(pool);
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // All routes require authentication
    this.router.use(authMiddleware);

    // Query audit logs
    this.router.get('/logs', this.queryLogs.bind(this));

    // Get audit statistics
    this.router.get('/stats', this.getStats.bind(this));

    // Generate audit report
    this.router.post('/reports', this.generateReport.bind(this));

    // Export audit logs
    this.router.get('/export', this.exportLogs.bind(this));

    // Apply retention policy (admin only)
    this.router.post('/retention/apply', this.applyRetention.bind(this));
  }

  /**
   * GET /api/v1/audit/logs
   * Query audit logs with filters
   */
  private async queryLogs(req: Request, res: Response): Promise<void> {
    try {
      const validated = querySchema.parse(req.query);

      const filters = {
        agent_id: validated.agent_id,
        action: validated.action,
        resource_type: validated.resource_type,
        resource_id: validated.resource_id,
        status: validated.status,
        start_date: validated.start_date ? new Date(validated.start_date) : undefined,
        end_date: validated.end_date ? new Date(validated.end_date) : undefined,
        limit: validated.limit || 100,
        offset: validated.offset || 0,
      };

      const logs = await this.auditService.query(filters);

      res.json({
        success: true,
        data: logs,
        pagination: {
          limit: filters.limit,
          offset: filters.offset,
          count: logs.length,
        },
      });
    } catch (error) {
      logger.error('Failed to query audit logs', { error });
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.issues,
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to query audit logs',
        });
      }
    }
  }

  /**
   * GET /api/v1/audit/stats
   * Get audit log statistics
   */
  private async getStats(req: Request, res: Response): Promise<void> {
    try {
      const validated = statsSchema.parse(req.query);

      const start_date = validated.start_date ? new Date(validated.start_date) : undefined;
      const end_date = validated.end_date ? new Date(validated.end_date) : undefined;

      const stats = await this.auditService.getStats(start_date, end_date);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('Failed to get audit stats', { error });
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.issues,
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to get audit statistics',
        });
      }
    }
  }

  /**
   * POST /api/v1/audit/reports
   * Generate an audit report for a time period
   */
  private async generateReport(req: Request, res: Response): Promise<void> {
    try {
      const validated = reportSchema.parse(req.body);

      const start_date = new Date(validated.start_date);
      const end_date = new Date(validated.end_date);

      const report = await this.auditService.generateReport(start_date, end_date);

      res.json({
        success: true,
        data: report,
      });
    } catch (error) {
      logger.error('Failed to generate audit report', { error });
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.issues,
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to generate audit report',
        });
      }
    }
  }

  /**
   * GET /api/v1/audit/export
   * Export audit logs in JSON or CSV format
   */
  private async exportLogs(req: Request, res: Response): Promise<void> {
    try {
      const validated = exportSchema.parse(req.query);

      const filters = {
        agent_id: validated.agent_id,
        action: validated.action,
        start_date: validated.start_date ? new Date(validated.start_date) : undefined,
        end_date: validated.end_date ? new Date(validated.end_date) : undefined,
        limit: 10000, // Higher limit for exports
      };

      const format = validated.format || 'json';
      const exportData = await this.auditService.exportLogs(filters, format);

      // Set appropriate headers
      const filename = `audit-logs-${Date.now()}.${format}`;
      const contentType = format === 'json' ? 'application/json' : 'text/csv';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(exportData);
    } catch (error) {
      logger.error('Failed to export audit logs', { error });
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.issues,
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to export audit logs',
        });
      }
    }
  }

  /**
   * POST /api/v1/audit/retention/apply
   * Apply retention policy to delete old logs (admin only)
   */
  private async applyRetention(req: Request, res: Response): Promise<void> {
    try {
      // TODO: Add admin role check here
      // For now, any authenticated user can trigger this

      const deletedCount = await this.auditService.applyRetentionPolicy();

      res.json({
        success: true,
        message: 'Retention policy applied successfully',
        data: {
          deleted_count: deletedCount,
        },
      });
    } catch (error) {
      logger.error('Failed to apply retention policy', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to apply retention policy',
      });
    }
  }

  /**
   * Get the audit service instance (for use in other modules)
   */
  public getAuditService(): AuditService {
    return this.auditService;
  }
}

/**
 * Factory function to create audit router
 */
export function createAuditRouter(pool: Pool): Router {
  const controller = new AuditController(pool);
  return controller.router;
}

/**
 * Export audit service instance creator
 */
export function createAuditService(pool: Pool): AuditService {
  return new AuditService(pool);
}
