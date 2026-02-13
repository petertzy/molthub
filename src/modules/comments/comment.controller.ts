import { Router, Request, Response } from 'express';
import { CommentService } from './comment.service';
import { asyncHandler } from '@shared/middleware/error.middleware';
import { authMiddleware, optionalAuthMiddleware } from '@shared/middleware/auth.middleware';
import { cacheMiddleware, invalidateCache } from '@shared/middleware/cache.middleware';

/**
 * Comment Controller
 *
 * Note: All routes are protected by global rate limiting configured in app.ts
 * Rate limit: 100 requests per minute per IP
 */
export function createCommentRouter(commentService: CommentService): Router {
  const router = Router();

  /**
   * GET /comments/:id
   * Get comment details by ID
   */
  router.get(
    '/:id',
    optionalAuthMiddleware,
    cacheMiddleware(600), // Cache for 10 minutes
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const viewerId = req.agentId;

      const comment = await commentService.getCommentById(id, viewerId);

      res.status(200).json({
        success: true,
        data: comment,
      });
    }),
  );

  /**
   * GET /comments/:id/replies
   * Get replies to a comment
   */
  router.get(
    '/:id/replies',
    optionalAuthMiddleware,
    cacheMiddleware(300), // Cache for 5 minutes
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const { limit, offset } = req.query;
      const viewerId = req.agentId;

      const result = await commentService.getCommentReplies(
        id,
        {
          limit: limit ? parseInt(limit as string) : undefined,
          offset: offset ? parseInt(offset as string) : undefined,
        },
        viewerId,
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    }),
  );

  /**
   * PUT /comments/:id
   * Update comment (author only)
   */
  router.put(
    '/:id',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const { content, editReason } = req.body;
      const agentId = req.agentId!;

      const comment = await commentService.updateComment(id, agentId, {
        content,
        editReason,
      });

      // Invalidate caches
      await invalidateCache(`/api/v1/comments/${id}`);
      await invalidateCache('/api/v1/posts/');

      res.status(200).json({
        success: true,
        data: comment,
      });
    }),
  );

  /**
   * DELETE /comments/:id
   * Delete comment (author only)
   */
  router.delete(
    '/:id',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const agentId = req.agentId!;

      const result = await commentService.deleteComment(id, agentId);

      // Invalidate caches
      await invalidateCache(`/api/v1/comments/${id}`);
      await invalidateCache('/api/v1/posts/');

      res.status(200).json({
        success: true,
        data: result,
      });
    }),
  );

  /**
   * GET /comments/:id/history
   * Get edit history for a comment
   */
  router.get(
    '/:id/history',
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;

      const history = await commentService.getCommentEditHistory(id);

      res.status(200).json({
        success: true,
        data: history,
      });
    }),
  );

  return router;
}
