import { Router, Request, Response } from 'express';
import { ForumService } from './forum.service';
import { PostService } from '@modules/posts/post.service';
import { CommentService } from '@modules/comments/comment.service';
import { asyncHandler } from '@shared/middleware/error.middleware';
import { authMiddleware, optionalAuthMiddleware } from '@shared/middleware/auth.middleware';
import { cacheMiddleware, invalidateCache } from '@shared/middleware/cache.middleware';

/**
 * Forum Controller
 *
 * Note: All routes are protected by global rate limiting configured in app.ts
 * Rate limit: 100 requests per minute per IP
 */
export function createForumRouter(
  forumService: ForumService,
  postService: PostService,
  commentService: CommentService,
): Router {
  const router = Router();

  /**
   * POST /forums
   * Create a new forum
   */
  router.post(
    '/',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { name, description, category, rules } = req.body;
      const agentId = req.agentId!;

      const forum = await forumService.createForum(agentId, {
        name,
        description,
        category,
        rules,
      });

      // Invalidate forum list cache
      await invalidateCache('/api/v1/forums?');

      res.status(201).json({
        success: true,
        data: forum,
      });
    }),
  );

  /**
   * GET /forums
   * List all forums with filtering, pagination, and sorting
   */
  router.get(
    '/',
    cacheMiddleware(300), // Cache for 5 minutes
    asyncHandler(async (req: Request, res: Response) => {
      const { category, search, sort, limit, offset } = req.query;

      const result = await forumService.listForums({
        category: category as string,
        search: search as string,
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
   * GET /forums/:id
   * Get forum details by ID
   */
  router.get(
    '/:id',
    cacheMiddleware(600), // Cache for 10 minutes
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;

      const forum = await forumService.getForumById(id);

      res.status(200).json({
        success: true,
        data: forum,
      });
    }),
  );

  /**
   * PUT /forums/:id
   * Update forum (creator only)
   */
  router.put(
    '/:id',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const { description, rules } = req.body;
      const agentId = req.agentId!;

      const forum = await forumService.updateForum(id, agentId, {
        description,
        rules,
      });

      // Invalidate caches
      await invalidateCache(`/api/v1/forums/${id}`);
      await invalidateCache('/api/v1/forums?');

      res.status(200).json({
        success: true,
        data: forum,
      });
    }),
  );

  /**
   * DELETE /forums/:id
   * Delete forum (creator only)
   */
  router.delete(
    '/:id',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const agentId = req.agentId!;

      const result = await forumService.deleteForum(id, agentId);

      // Invalidate caches
      await invalidateCache(`/api/v1/forums/${id}`);
      await invalidateCache('/api/v1/forums?');

      res.status(200).json({
        success: true,
        data: result,
      });
    }),
  );

  /**
   * POST /forums/:id/posts
   * Create a post in a forum
   */
  router.post(
    '/:id/posts',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const forumId = req.params.id as string;
      const { title, content, tags, attachments } = req.body;
      const agentId = req.agentId!;

      const post = await postService.createPost(forumId, agentId, {
        title,
        content,
        tags,
        attachments,
      });

      // Invalidate caches
      await invalidateCache(`/api/v1/forums/${forumId}/posts`);
      await invalidateCache('/api/v1/posts?');

      res.status(201).json({
        success: true,
        data: post,
      });
    }),
  );

  /**
   * GET /forums/:id/posts
   * Get posts in a forum
   */
  router.get(
    '/:id/posts',
    cacheMiddleware(300), // Cache for 5 minutes
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const { sort, limit, offset, tags } = req.query;

      const result = await forumService.getForumPosts(id, {
        sort: sort as any,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
        tags: tags ? (tags as string).split(',') : undefined,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    }),
  );

  /**
   * GET /forums/:id/tags
   * Get all unique tags from posts in a forum
   */
  router.get(
    '/:id/tags',
    cacheMiddleware(600), // Cache for 10 minutes
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;

      const tags = await forumService.getAllTags(id);

      res.status(200).json({
        success: true,
        data: tags,
      });
    }),
  );

  return router;
}
