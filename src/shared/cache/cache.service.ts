import { RedisClientType } from 'redis';
import RedisClient from '@config/redis';
import { logger } from '@config/logger';
import { metricsService } from '@shared/metrics';

/**
 * Cache key prefixes for different data types
 */
export const CacheKeys = {
  // Forum related
  FORUM_HOT: 'forum:hot',
  FORUM_TRENDING: 'forums:trending',
  FORUM_DETAIL: (forumId: string) => `forum:${forumId}:detail`,
  FORUM_POSTS: (forumId: string, sort: string) => `forum:${forumId}:posts:${sort}`,

  // Post related
  POST_HOT: (forumId: string) => `forum:${forumId}:posts:hot`,
  POST_DETAIL: (postId: string) => `post:${postId}:detail`,

  // Agent related
  AGENT_STATS: (agentId: string) => `agent:${agentId}:stats`,
  AGENT_PROFILE: (agentId: string) => `agent:${agentId}:profile`,

  // Statistics
  CACHE_STATS: 'cache:stats',
} as const;

/**
 * TTL configurations for different data types (in seconds)
 */
export const CacheTTL = {
  SHORT: 300, // 5 minutes - for hot/trending data
  MEDIUM: 3600, // 1 hour - for forum/post details
  LONG: 86400, // 1 day - for agent profiles
  STATS: 21600, // 6 hours - for statistics
} as const;

/**
 * Cache statistics interface
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  lastReset: string;
}

/**
 * Centralized cache service for managing Redis operations
 */
export class CacheService {
  private redis: RedisClientType | null = null;
  private initialized = false;
  private stats: { hits: number; misses: number; lastReset: Date } = {
    hits: 0,
    misses: 0,
    lastReset: new Date(),
  };

  /**
   * Initialize Redis connection
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.redis = await RedisClient.getInstance();
      if (this.redis) {
        this.initialized = true;
        logger.info('CacheService initialized with Redis connection');

        // Load stats from Redis if available
        await this.loadStats();
      } else {
        logger.warn('CacheService initialized without Redis - caching disabled');
      }
    } catch (error) {
      logger.error('Failed to initialize CacheService', { error });
      this.redis = null;
    }
  }

  /**
   * Check if cache is available
   */
  isAvailable(): boolean {
    return this.redis !== null;
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.redis) {
      return null;
    }

    const startTime = Date.now();
    try {
      const data = await this.redis.get(key);
      const duration = (Date.now() - startTime) / 1000;

      if (data) {
        this.stats.hits++;
        await this.updateStats();
        logger.debug('Cache hit', { key });

        // Record metrics
        const keyPrefix = metricsService.extractKeyPrefix(key);
        metricsService.recordCacheHit(keyPrefix);
        metricsService.recordCacheOperation('get', keyPrefix, duration);

        return JSON.parse(data) as T;
      } else {
        this.stats.misses++;
        await this.updateStats();
        logger.debug('Cache miss', { key });

        // Record metrics
        const keyPrefix = metricsService.extractKeyPrefix(key);
        metricsService.recordCacheMiss(keyPrefix);
        metricsService.recordCacheOperation('get', keyPrefix, duration);

        return null;
      }
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      logger.error('Cache get error', { key, error });
      this.stats.misses++;
      await this.updateStats();

      // Record metrics
      const keyPrefix = metricsService.extractKeyPrefix(key);
      metricsService.recordCacheMiss(keyPrefix);
      metricsService.recordCacheOperation('get', keyPrefix, duration);

      return null;
    }
  }

  /**
   * Set value in cache with TTL
   */
  async set<T>(key: string, value: T, ttl: number = CacheTTL.MEDIUM): Promise<void> {
    if (!this.redis) {
      return;
    }

    const startTime = Date.now();
    try {
      await this.redis.setEx(key, ttl, JSON.stringify(value));
      const duration = (Date.now() - startTime) / 1000;
      logger.debug('Cache set', { key, ttl });

      // Record metrics
      const keyPrefix = metricsService.extractKeyPrefix(key);
      metricsService.recordCacheOperation('set', keyPrefix, duration);
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      logger.error('Cache set error', { key, error });

      // Record metrics
      const keyPrefix = metricsService.extractKeyPrefix(key);
      metricsService.recordCacheOperation('set', keyPrefix, duration);
    }
  }

  /**
   * Delete a single key from cache
   */
  async delete(key: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.del(key);
      logger.debug('Cache deleted', { key });
    } catch (error) {
      logger.error('Cache delete error', { key, error });
    }
  }

  /**
   * Invalidate cache by pattern
   * WARNING: Use with caution, KEYS command can be slow on large datasets
   */
  async invalidatePattern(pattern: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(keys);
        logger.info('Cache invalidated', { pattern, count: keys.length });
      }
    } catch (error) {
      logger.error('Cache invalidate error', { pattern, error });
    }
  }

  /**
   * Get hot posts for a forum
   */
  async getHotPosts(forumId: string): Promise<any[] | null> {
    const key = CacheKeys.POST_HOT(forumId);
    return this.get<any[]>(key);
  }

  /**
   * Set hot posts for a forum
   */
  async setHotPosts(forumId: string, posts: any[]): Promise<void> {
    const key = CacheKeys.POST_HOT(forumId);
    await this.set(key, posts, CacheTTL.SHORT);
  }

  /**
   * Get trending forums
   */
  async getTrendingForums(): Promise<any[] | null> {
    return this.get<any[]>(CacheKeys.FORUM_TRENDING);
  }

  /**
   * Set trending forums
   */
  async setTrendingForums(forums: any[]): Promise<void> {
    await this.set(CacheKeys.FORUM_TRENDING, forums, CacheTTL.SHORT);
  }

  /**
   * Get agent statistics
   */
  async getAgentStats(agentId: string): Promise<any | null> {
    const key = CacheKeys.AGENT_STATS(agentId);
    return this.get<any>(key);
  }

  /**
   * Set agent statistics
   */
  async setAgentStats(agentId: string, stats: any): Promise<void> {
    const key = CacheKeys.AGENT_STATS(agentId);
    await this.set(key, stats, CacheTTL.MEDIUM);
  }

  /**
   * Invalidate agent-related caches
   */
  async invalidateAgent(agentId: string): Promise<void> {
    await this.invalidatePattern(`agent:${agentId}:*`);
  }

  /**
   * Invalidate forum-related caches
   */
  async invalidateForum(forumId: string): Promise<void> {
    await this.invalidatePattern(`forum:${forumId}:*`);
  }

  /**
   * Invalidate post-related caches
   */
  async invalidatePost(postId: string): Promise<void> {
    const key = CacheKeys.POST_DETAIL(postId);
    await this.delete(key);
  }

  /**
   * Invalidate trending data (when new content is created)
   */
  async invalidateTrending(): Promise<void> {
    await this.delete(CacheKeys.FORUM_TRENDING);
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: Math.round(hitRate * 100) / 100,
      lastReset: this.stats.lastReset.toISOString(),
    };
  }

  /**
   * Reset cache statistics
   */
  async resetStats(): Promise<void> {
    this.stats = {
      hits: 0,
      misses: 0,
      lastReset: new Date(),
    };
    await this.updateStats();
    logger.info('Cache statistics reset');
  }

  /**
   * Update statistics in Redis
   */
  private async updateStats(): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      // Only update stats every 10 operations to reduce overhead
      const total = this.stats.hits + this.stats.misses;
      if (total % 10 === 0) {
        await this.redis.set(CacheKeys.CACHE_STATS, JSON.stringify(this.stats));
      }
    } catch (error) {
      // Ignore stats update errors
    }
  }

  /**
   * Load statistics from Redis
   */
  private async loadStats(): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      const data = await this.redis.get(CacheKeys.CACHE_STATS);
      if (data) {
        const stats = JSON.parse(data);
        this.stats = {
          hits: stats.hits || 0,
          misses: stats.misses || 0,
          lastReset: new Date(stats.lastReset || new Date()),
        };
        logger.info('Cache statistics loaded', this.stats);
      }
    } catch (error) {
      logger.warn('Failed to load cache statistics', { error });
    }
  }

  /**
   * Flush all cache data (use with extreme caution)
   */
  async flush(): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.flushDb();
      await this.resetStats();
      logger.warn('Cache flushed - all data cleared');
    } catch (error) {
      logger.error('Cache flush error', { error });
    }
  }
}

// Export singleton instance
export const cacheService = new CacheService();
