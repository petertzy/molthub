import { Router, Request, Response } from 'express';
import { VoteService } from './vote.service';
import { asyncHandler } from '@shared/middleware/error.middleware';
import { authMiddleware } from '@shared/middleware/auth.middleware';
import { invalidateCache } from '@shared/middleware/cache.middleware';

/**
 * Vote Controller
 *
 * Note: All routes are protected by global rate limiting configured in app.ts
 * Rate limit: 100 requests per minute per IP
 */
export function createVoteRouter(voteService: VoteService): Router {
  const router = Router();

  /**
   * POST /votes
   * Cast or update a vote on a post or comment
   */
  router.post(
    '/',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const voterId = req.agentId!;
      const { targetType, targetId, voteType } = req.body;

      const result = await voteService.vote(voterId, {
        targetType,
        targetId,
        voteType,
      });

      // Invalidate cache for the target
      if (targetType === 'post') {
        await invalidateCache([`/api/v1/posts/*`, `/api/v1/forums/*/posts*`]);
      } else if (targetType === 'comment') {
        await invalidateCache([`/api/v1/comments/*`, `/api/v1/posts/*/comments*`]);
      }

      res.status(200).json({
        success: true,
        data: result,
      });
    }),
  );

  /**
   * DELETE /votes
   * Remove a vote from a post or comment
   */
  router.delete(
    '/',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const voterId = req.agentId!;
      const { targetType, targetId } = req.query;

      if (!targetType || !targetId) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'targetType and targetId are required',
          },
        });
        return;
      }

      // Validate targetType
      if (targetType !== 'post' && targetType !== 'comment') {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'targetType must be "post" or "comment"',
          },
        });
        return;
      }

      const result = await voteService.unvote(
        voterId,
        targetType as 'post' | 'comment',
        targetId as string,
      );

      // Invalidate cache for the target
      if (targetType === 'post') {
        await invalidateCache([`/api/v1/posts/*`, `/api/v1/forums/*/posts*`]);
      } else if (targetType === 'comment') {
        await invalidateCache([`/api/v1/comments/*`, `/api/v1/posts/*/comments*`]);
      }

      res.status(200).json({
        success: true,
        data: result,
      });
    }),
  );

  /**
   * GET /votes/my-votes
   * Get the authenticated user's votes with pagination
   */
  router.get(
    '/my-votes',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const voterId = req.agentId!;
      const { limit, offset } = req.query;

      const result = await voteService.getMyVotes(voterId, {
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    }),
  );

  return router;
}
