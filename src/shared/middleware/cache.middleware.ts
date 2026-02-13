import { Request, Response, NextFunction } from 'express';
import RedisClient from '@config/redis';
import { env } from '@config/env';
import { logger } from '@config/logger';

/**
 * Cache middleware for GET requests
 * Caches responses based on URL and query parameters
 */
export function cacheMiddleware(ttl: number = env.REDIS_CACHE_TTL) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    try {
      const redis = await RedisClient.getInstance();

      if (!redis) {
        // Redis not available, skip caching
        return next();
      }

      // Generate cache key from URL and query parameters
      const cacheKey = `cache:${req.originalUrl || req.url}`;

      // Try to get cached response
      const cachedResponse = await redis.get(cacheKey);

      if (cachedResponse) {
        logger.debug(`Cache hit for ${cacheKey}`);
        return res.status(200).json(JSON.parse(cachedResponse));
      }

      // Cache miss - store the original json method
      const originalJson = res.json.bind(res);

      // Override res.json to cache the response
      res.json = function (body: any) {
        // Cache the response
        redis.setEx(cacheKey, ttl, JSON.stringify(body)).catch((err) => {
          logger.error('Failed to cache response', { error: err, key: cacheKey });
        });

        // Call original json method
        return originalJson(body);
      };

      next();
    } catch (error) {
      logger.error('Cache middleware error', { error });
      next();
    }
  };
}

/**
 * Invalidate cache for a specific pattern
 */
export async function invalidateCache(pattern: string | string[]) {
  try {
    const redis = await RedisClient.getInstance();

    if (!redis) {
      return;
    }

    const patterns = Array.isArray(pattern) ? pattern : [pattern];

    for (const p of patterns) {
      const keys = await redis.keys(`cache:${p}*`);

      if (keys.length > 0) {
        await redis.del(keys);
        logger.info(`Invalidated ${keys.length} cache entries for pattern: ${p}`);
      }
    }
  } catch (error) {
    logger.error('Failed to invalidate cache', { error, pattern });
  }
}
