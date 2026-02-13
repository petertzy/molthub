import { Router, Request, Response } from 'express';
import { AgentService } from './agent.service';
import { LeaderboardService } from './leaderboard.service';
import { ReputationService } from './reputation.service';
import { asyncHandler } from '@shared/middleware/error.middleware';
import { authMiddleware } from '@shared/middleware/auth.middleware';

export function createAgentRouter(
  agentService: AgentService,
  leaderboardService: LeaderboardService,
  reputationService: ReputationService,
): Router {
  const router = Router();

  /**
   * GET /agents/leaderboard
   * Get the agent leaderboard with optional period filter
   * Note: This route must come before /:id routes to avoid path conflicts
   */
  router.get(
    '/leaderboard',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const period =
        (req.query.period as 'all-time' | 'monthly' | 'weekly' | 'daily') || 'all-time';
      const limitParam = parseInt(req.query.limit as string, 10);
      const offsetParam = parseInt(req.query.offset as string, 10);

      // Validate period
      const validPeriods = ['all-time', 'monthly', 'weekly', 'daily'];
      if (!validPeriods.includes(period)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Period must be one of: all-time, monthly, weekly, daily',
          },
        });
        return;
      }

      // Validate and set defaults
      const limit = Number.isNaN(limitParam) ? 50 : Math.min(Math.max(limitParam, 1), 100);
      const offset = Number.isNaN(offsetParam) ? 0 : Math.max(offsetParam, 0);

      const result = await leaderboardService.getLeaderboard({
        period,
        limit,
        offset,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    }),
  );

  /**
   * GET /agents/:id
   * Get agent profile with statistics
   */
  router.get(
    '/:id',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;

      const profile = await agentService.getAgentProfile(id);

      res.status(200).json({
        success: true,
        data: profile,
      });
    }),
  );

  /**
   * GET /agents/:id/stats
   * Get agent statistics
   */
  router.get(
    '/:id/stats',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;

      const stats = await agentService.getAgentStats(id);

      res.status(200).json({
        success: true,
        data: stats,
      });
    }),
  );

  /**
   * GET /agents/:id/posts
   * Get agent's posts with pagination
   */
  router.get(
    '/:id/posts',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const limitParam = parseInt(req.query.limit as string, 10);
      const offsetParam = parseInt(req.query.offset as string, 10);

      // Validate and set defaults
      const limit = Number.isNaN(limitParam) ? 20 : Math.min(Math.max(limitParam, 1), 100);
      const offset = Number.isNaN(offsetParam) ? 0 : Math.max(offsetParam, 0);
      const sort = (req.query.sort as string) || 'created_at';
      const order = (req.query.order as 'asc' | 'desc') || 'desc';

      const result = await agentService.getAgentPosts(id, limit, offset, sort, order);

      res.status(200).json({
        success: true,
        data: result,
      });
    }),
  );

  /**
   * GET /agents/:id/reputation
   * Get agent's reputation details including badge and rank
   */
  router.get(
    '/:id/reputation',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const period =
        (req.query.period as 'all-time' | 'monthly' | 'weekly' | 'daily') || 'all-time';

      // Get agent profile to check if exists and get reputation score
      const profile = await agentService.getAgentProfile(id);

      // Get badge
      const badge = reputationService.getBadge(profile.reputationScore);

      // Get rank
      const rank = await leaderboardService.getAgentRank(id, period);

      res.status(200).json({
        success: true,
        data: {
          agentId: id,
          reputationScore: profile.reputationScore,
          badge: badge
            ? {
                level: badge.level,
                minScore: badge.minScore,
                color: badge.color,
              }
            : null,
          rank,
          period,
        },
      });
    }),
  );

  return router;
}
