import { Router, Request, Response } from 'express';
import { PostService } from './post.service';
import { CommentService } from '@modules/comments/comment.service';
import { asyncHandler } from '@shared/middleware/error.middleware';
import { authMiddleware, optionalAuthMiddleware } from '@shared/middleware/auth.middleware';
import { cacheMiddleware, invalidateCache } from '@shared/middleware/cache.middleware';

/**
 * Post Controller
 *
 * Note: All routes are protected by global rate limiting configured in app.ts
 * Rate limit: 100 requests per minute per IP
 */
export function createPostRouter(postService: PostService, commentService: CommentService): Router {
  const router = Router();

  /**
   * GET /posts
   * List posts with filtering, sorting, and pagination
   */
  router.get(
    '/',
    cacheMiddleware(300), // Cache for 5 minutes
    asyncHandler(async (req: Request, res: Response) => {
      const { forumId, authorId, tags, sort, limit, offset } = req.query;

      const result = await postService.listPosts({
        forumId: forumId as string,
        authorId: authorId as string,
        tags: tags ? (tags as string).split(',') : undefined,
        sort: sort as any,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    }),
  );

  /**
   * GET /posts/:id
   * Get post details by ID
   */
  router.get(
    '/:id',
    optionalAuthMiddleware,
    cacheMiddleware(600), // Cache for 10 minutes
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const viewerId = req.agentId;

      const post = await postService.getPostById(id, viewerId);

      res.status(200).json({
        success: true,
        data: post,
      });
    }),
  );

  /**
   * PUT /posts/:id
   * Update post (author only)
   */
  router.put(
    '/:id',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const { title, content, tags, editReason } = req.body;
      const agentId = req.agentId!;

      const post = await postService.updatePost(id, agentId, {
        title,
        content,
        tags,
        editReason,
      });

      // Invalidate caches
      await invalidateCache(`/api/v1/posts/${id}`);
      await invalidateCache('/api/v1/posts?');

      res.status(200).json({
        success: true,
        data: post,
      });
    }),
  );

  /**
   * DELETE /posts/:id
   * Delete post (author only)
   */
  router.delete(
    '/:id',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const agentId = req.agentId!;

      const result = await postService.deletePost(id, agentId);

      // Invalidate caches
      await invalidateCache(`/api/v1/posts/${id}`);
      await invalidateCache('/api/v1/posts?');

      res.status(200).json({
        success: true,
        data: result,
      });
    }),
  );

  /**
   * POST /posts/:id/comments
   * Create a comment on a post
   */
  router.post(
    '/:id/comments',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const postId = req.params.id as string;
      const { content, parentCommentId } = req.body;
      const agentId = req.agentId!;

      const comment = await commentService.createComment(postId, agentId, {
        content,
        parentCommentId,
      });

      // Invalidate caches
      await invalidateCache(`/api/v1/posts/${postId}/comments`);
      await invalidateCache(`/api/v1/posts/${postId}`);

      res.status(201).json({
        success: true,
        data: comment,
      });
    }),
  );

  /**
   * GET /posts/:id/comments
   * Get comments for a post
   */
  router.get(
    '/:id/comments',
    optionalAuthMiddleware,
    cacheMiddleware(300), // Cache for 5 minutes
    asyncHandler(async (req: Request, res: Response) => {
      const postId = req.params.id as string;
      const { sort, limit, offset, threadView } = req.query;
      const viewerId = req.agentId;

      const result = await commentService.getPostComments(
        postId,
        {
          sort: sort as any,
          limit: limit ? parseInt(limit as string) : undefined,
          offset: offset ? parseInt(offset as string) : undefined,
          threadView: threadView === 'true',
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
   * GET /posts/:id/history
   * Get edit history for a post
   */
  router.get(
    '/:id/history',
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;

      const history = await postService.getPostEditHistory(id);

      res.status(200).json({
        success: true,
        data: history,
      });
    }),
  );

  return router;
}
