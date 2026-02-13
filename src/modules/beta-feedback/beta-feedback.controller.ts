import { Request, Response, Router } from 'express';
import { BetaFeedbackService } from './beta-feedback.service';
import { logger } from '@config/logger';
import { CreateFeedbackDto, CreateFeedbackCommentDto, RecordMetricDto } from './beta-feedback.types';

export class BetaFeedbackController {
  public router: Router;

  constructor(
    private feedbackService: BetaFeedbackService,
    private logger: any = logger
  ) {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // Feedback endpoints
    this.router.post('/feedback', this.createFeedback.bind(this));
    this.router.get('/feedback', this.listFeedback.bind(this));
    this.router.get('/feedback/:id', this.getFeedback.bind(this));
    this.router.put('/feedback/:id', this.updateFeedback.bind(this));
    this.router.delete('/feedback/:id', this.deleteFeedback.bind(this));

    // Feedback comments
    this.router.post('/feedback/:id/comments', this.addComment.bind(this));
    this.router.get('/feedback/:id/comments', this.getComments.bind(this));

    // Metrics
    this.router.post('/metrics', this.recordMetric.bind(this));

    // Stats
    this.router.get('/stats', this.getStats.bind(this));
  }

  /**
   * Create feedback
   * POST /api/v1/beta/feedback
   */
  private async createFeedback(req: Request, res: Response): Promise<void> {
    try {
      const agentId = req.agentId;
      if (!agentId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      // Validate request body
      const data: CreateFeedbackDto = req.body;
      if (!data.category || !data.severity || !data.title || !data.description) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: category, severity, title, description',
        });
        return;
      }

      // Validate category
      const validCategories = ['bug', 'feature', 'performance', 'usability', 'documentation', 'other'];
      if (!validCategories.includes(data.category)) {
        res.status(400).json({
          success: false,
          error: `Invalid category. Must be one of: ${validCategories.join(', ')}`,
        });
        return;
      }

      // Validate severity
      const validSeverities = ['critical', 'high', 'medium', 'low'];
      if (!validSeverities.includes(data.severity)) {
        res.status(400).json({
          success: false,
          error: `Invalid severity. Must be one of: ${validSeverities.join(', ')}`,
        });
        return;
      }

      const ipAddress = req.ip;
      const userAgent = req.get('user-agent');

      const feedback = await this.feedbackService.createFeedback(agentId, data, ipAddress, userAgent);

      this.logger.info('Feedback created', { feedbackId: feedback.id, agentId });

      res.status(201).json({
        success: true,
        data: feedback,
      });
    } catch (error) {
      this.logger.error('Error creating feedback', { error });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * List feedback
   * GET /api/v1/beta/feedback?category=bug&severity=high&status=new
   */
  private async listFeedback(req: Request, res: Response): Promise<void> {
    try {
      const agentId = req.agentId;
      if (!agentId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const {
        category,
        severity,
        status,
        limit = '50',
        offset = '0',
        all, // Admin flag to see all feedback
      } = req.query;

      // Only allow admins to see all feedback (for now, disabled admin check)
      const filterAgentId = all === 'true' ? undefined : agentId;

      const result = await this.feedbackService.listFeedback({
        agentId: filterAgentId,
        category: category as any,
        severity: severity as any,
        status: status as any,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      });

      res.json({
        success: true,
        data: result.feedback,
        pagination: {
          total: result.total,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
        },
      });
    } catch (error) {
      this.logger.error('Error listing feedback', { error });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get feedback by ID
   * GET /api/v1/beta/feedback/:id
   */
  private async getFeedback(req: Request, res: Response): Promise<void> {
    try {
      const agentId = req.agentId;
      if (!agentId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const { id } = req.params;
      const isAdmin = false; // For now, no admin role check

      const feedback = await this.feedbackService.getFeedbackById(
        id as string,
        isAdmin ? undefined : agentId
      );

      if (!feedback) {
        res.status(404).json({
          success: false,
          error: 'Feedback not found',
        });
        return;
      }

      res.json({
        success: true,
        data: feedback,
      });
    } catch (error) {
      this.logger.error('Error getting feedback', { error });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Update feedback (admin only)
   * PUT /api/v1/beta/feedback/:id
   */
  private async updateFeedback(req: Request, res: Response): Promise<void> {
    try {
      const agentId = req.agentId;
      if (!agentId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      // For now, allow any authenticated agent to update (in production, add admin check)
      // if (req.user?.role !== 'admin') {
      //   res.status(403).json({
      //     success: false,
      //     error: 'Admin access required',
      //   });
      //   return;
      // }

      const { id } = req.params;
      const feedback = await this.feedbackService.updateFeedback(id as string, req.body, agentId);

      res.json({
        success: true,
        data: feedback,
      });
    } catch (error) {
      this.logger.error('Error updating feedback', { error });
      if ((error as Error).message === 'Feedback not found') {
        res.status(404).json({
          success: false,
          error: 'Feedback not found',
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Delete feedback (admin only)
   * DELETE /api/v1/beta/feedback/:id
   */
  private async deleteFeedback(req: Request, res: Response): Promise<void> {
    try {
      const agentId = req.agentId;
      if (!agentId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      // For now, allow deletion (in production, restrict to admin)
      // if (req.user?.role !== 'admin') {
      //   res.status(403).json({
      //     success: false,
      //     error: 'Admin access required',
      //   });
      //   return;
      // }

      const { id } = req.params;
      await this.feedbackService.deleteFeedback(id as string);

      res.json({
        success: true,
        message: 'Feedback deleted',
      });
    } catch (error) {
      this.logger.error('Error deleting feedback', { error });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Add comment to feedback
   * POST /api/v1/beta/feedback/:id/comments
   */
  private async addComment(req: Request, res: Response): Promise<void> {
    try {
      const agentId = req.agentId;
      if (!agentId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const { id } = req.params;
      const data: CreateFeedbackCommentDto = req.body;

      if (!data.comment) {
        res.status(400).json({
          success: false,
          error: 'Comment text is required',
        });
        return;
      }

      const comment = await this.feedbackService.addComment(id as string, agentId, data);

      res.status(201).json({
        success: true,
        data: comment,
      });
    } catch (error) {
      this.logger.error('Error adding comment', { error });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get comments for feedback
   * GET /api/v1/beta/feedback/:id/comments
   */
  private async getComments(req: Request, res: Response): Promise<void> {
    try {
      const agentId = req.agentId;
      if (!agentId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const { id } = req.params;
      const includeInternal = req.query.internal === 'true'; // No admin check for now

      const comments = await this.feedbackService.getComments(id as string, includeInternal);

      res.json({
        success: true,
        data: comments,
      });
    } catch (error) {
      this.logger.error('Error getting comments', { error });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Record a metric
   * POST /api/v1/beta/metrics
   */
  private async recordMetric(req: Request, res: Response): Promise<void> {
    try {
      const agentId = req.agentId;
      if (!agentId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const data: RecordMetricDto = req.body;

      if (!data.metricType || data.metricValue === undefined) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: metricType, metricValue',
        });
        return;
      }

      const metric = await this.feedbackService.recordMetric(agentId, data);

      res.status(201).json({
        success: true,
        data: metric,
      });
    } catch (error) {
      this.logger.error('Error recording metric', { error });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get feedback statistics
   * GET /api/v1/beta/stats
   */
  private async getStats(req: Request, res: Response): Promise<void> {
    try {
      const agentId = req.agentId;
      if (!agentId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const all = req.query.all === 'true'; // No admin check for now
      const stats = await this.feedbackService.getStats(all ? undefined : agentId);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      this.logger.error('Error getting stats', { error });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
}
