/**
 * Search Controller
 * Handles search API endpoints
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { SearchService } from './search.service';
import { asyncHandler } from '@shared/middleware/error.middleware';
import { optionalAuthMiddleware } from '@shared/middleware/auth.middleware';
import { cacheMiddleware } from '@shared/middleware/cache.middleware';
import { SearchQuery, SemanticSearchQuery } from './search.types';

/**
 * Search Controller
 *
 * Note: All routes are protected by:
 * 1. Global rate limiting (100 req/min per IP) configured in app.ts
 * 2. Search-specific rate limiting (30 req/min per IP) for expensive operations
 */
export function createSearchRouter(searchService: SearchService): Router {
  const router = Router();

  // Additional rate limiting for search endpoints (more restrictive than global)
  const searchRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // limit each IP to 30 requests per windowMs
    message: 'Too many search requests from this IP, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Apply search-specific rate limiter to all routes in this router
  router.use(searchRateLimiter);

  /**
   * GET /search
   * Full-text search across posts, comments, forums, and agents
   */
  router.get(
    '/',
    optionalAuthMiddleware,
    cacheMiddleware(300), // Cache for 5 minutes
    asyncHandler(async (req: Request, res: Response) => {
      const { q, type, forum, sort, limit, offset } = req.query;

      // Validate required parameter
      if (!q || typeof q !== 'string' || q.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_QUERY',
            message: 'Search query (q) is required',
          },
        });
        return;
      }

      let normalizedType = type as string;
      if (normalizedType === 'agent') normalizedType = 'agents';
      if (normalizedType === 'post') normalizedType = 'posts';
      if (normalizedType === 'comment') normalizedType = 'comments';
      if (normalizedType === 'forum') normalizedType = 'forums';

      const searchQuery: SearchQuery = {
        q: q as string,
        type: normalizedType as any,
        forum: forum as string,
        sort: sort as any,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      };

      const result = await searchService.search(searchQuery);

      res.status(200).json({
        success: true,
        data: result,
      });
    }),
  );

  /**
   * POST /search/semantic
   * Semantic search using vector similarity
   *
   * Note: Caching disabled for POST requests to avoid stale data issues
   */
  router.post(
    '/semantic',
    optionalAuthMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { query, type, limit, minSimilarity } = req.body;

      // Validate required parameter
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_QUERY',
            message: 'Search query is required',
          },
        });
        return;
      }

      const semanticQuery: SemanticSearchQuery = {
        query,
        type,
        limit,
        minSimilarity,
      };

      try {
        const result = await searchService.semanticSearch(semanticQuery);

        res.status(200).json({
          success: true,
          data: result,
        });
      } catch (error: any) {
        if (error.message.includes('not available') || error.message.includes('not configured')) {
          res.status(503).json({
            success: false,
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message:
                'Semantic search is currently unavailable. Please use full-text search instead.',
            },
          });
          return;
        }
        throw error;
      }
    }),
  );

  return router;
}
