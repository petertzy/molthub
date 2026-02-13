import { CacheService, CacheKeys, CacheTTL, CacheStats } from '@shared/cache/cache.service';
import RedisClient from '@config/redis';

// Mock RedisClient
jest.mock('@config/redis', () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn(),
  },
}));

// Mock logger
jest.mock('@config/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('CacheService', () => {
  let cacheService: CacheService;
  let mockRedis: any;

  beforeEach(() => {
    // Create a fresh CacheService instance for each test
    cacheService = new CacheService();
    
    // Create mock Redis client
    mockRedis = {
      get: jest.fn(),
      setEx: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      keys: jest.fn(),
      flushDb: jest.fn(),
    };

    // Reset the mock
    (RedisClient.getInstance as jest.Mock).mockReset();
  });

  describe('initialize', () => {
    it('should initialize successfully with Redis connection', async () => {
      (RedisClient.getInstance as jest.Mock).mockResolvedValue(mockRedis);

      await cacheService.initialize();

      expect(cacheService.isAvailable()).toBe(true);
      expect(RedisClient.getInstance).toHaveBeenCalledTimes(1);
    });

    it('should handle Redis connection failure gracefully', async () => {
      (RedisClient.getInstance as jest.Mock).mockResolvedValue(null);

      await cacheService.initialize();

      expect(cacheService.isAvailable()).toBe(false);
    });

    it('should not reinitialize if already initialized', async () => {
      (RedisClient.getInstance as jest.Mock).mockResolvedValue(mockRedis);

      await cacheService.initialize();
      await cacheService.initialize();

      expect(RedisClient.getInstance).toHaveBeenCalledTimes(1);
    });

    it('should handle initialization error', async () => {
      (RedisClient.getInstance as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      await cacheService.initialize();

      expect(cacheService.isAvailable()).toBe(false);
    });
  });

  describe('get', () => {
    beforeEach(async () => {
      (RedisClient.getInstance as jest.Mock).mockResolvedValue(mockRedis);
      await cacheService.initialize();
    });

    it('should return null when Redis is not available', async () => {
      const noRedisCacheService = new CacheService();
      (RedisClient.getInstance as jest.Mock).mockResolvedValue(null);
      await noRedisCacheService.initialize();

      const result = await noRedisCacheService.get('test-key');

      expect(result).toBeNull();
    });

    it('should return cached value on cache hit', async () => {
      const testData = { id: '123', name: 'test' };
      mockRedis.get.mockResolvedValue(JSON.stringify(testData));

      const result = await cacheService.get<typeof testData>('test-key');

      expect(result).toEqual(testData);
      expect(mockRedis.get).toHaveBeenCalledWith('test-key');
    });

    it('should return null on cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await cacheService.get('test-key');

      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith('test-key');
    });

    it('should handle get error and return null', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis error'));

      const result = await cacheService.get('test-key');

      expect(result).toBeNull();
    });

    it('should update statistics on cache hit', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ data: 'test' }));

      await cacheService.get('test-key');
      const stats = await cacheService.getStats();

      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(0);
    });

    it('should update statistics on cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      await cacheService.get('test-key');
      const stats = await cacheService.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
    });
  });

  describe('set', () => {
    beforeEach(async () => {
      (RedisClient.getInstance as jest.Mock).mockResolvedValue(mockRedis);
      await cacheService.initialize();
    });

    it('should not do anything when Redis is not available', async () => {
      const noRedisCacheService = new CacheService();
      (RedisClient.getInstance as jest.Mock).mockResolvedValue(null);
      await noRedisCacheService.initialize();

      await noRedisCacheService.set('test-key', { data: 'test' });

      expect(mockRedis.setEx).not.toHaveBeenCalled();
    });

    it('should set value with default TTL', async () => {
      const testData = { id: '123', name: 'test' };

      await cacheService.set('test-key', testData);

      expect(mockRedis.setEx).toHaveBeenCalledWith(
        'test-key',
        CacheTTL.MEDIUM,
        JSON.stringify(testData)
      );
    });

    it('should set value with custom TTL', async () => {
      const testData = { id: '123', name: 'test' };

      await cacheService.set('test-key', testData, CacheTTL.SHORT);

      expect(mockRedis.setEx).toHaveBeenCalledWith(
        'test-key',
        CacheTTL.SHORT,
        JSON.stringify(testData)
      );
    });

    it('should handle set error gracefully', async () => {
      mockRedis.setEx.mockRejectedValue(new Error('Redis error'));

      await expect(cacheService.set('test-key', { data: 'test' })).resolves.not.toThrow();
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      (RedisClient.getInstance as jest.Mock).mockResolvedValue(mockRedis);
      await cacheService.initialize();
    });

    it('should delete key from cache', async () => {
      await cacheService.delete('test-key');

      expect(mockRedis.del).toHaveBeenCalledWith('test-key');
    });

    it('should handle delete error gracefully', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis error'));

      await expect(cacheService.delete('test-key')).resolves.not.toThrow();
    });
  });

  describe('invalidatePattern', () => {
    beforeEach(async () => {
      (RedisClient.getInstance as jest.Mock).mockResolvedValue(mockRedis);
      await cacheService.initialize();
    });

    it('should invalidate keys matching pattern', async () => {
      mockRedis.keys.mockResolvedValue(['key1', 'key2', 'key3']);

      await cacheService.invalidatePattern('test:*');

      expect(mockRedis.keys).toHaveBeenCalledWith('test:*');
      expect(mockRedis.del).toHaveBeenCalledWith(['key1', 'key2', 'key3']);
    });

    it('should not delete if no keys match pattern', async () => {
      mockRedis.keys.mockResolvedValue([]);

      await cacheService.invalidatePattern('test:*');

      expect(mockRedis.keys).toHaveBeenCalledWith('test:*');
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('should handle invalidatePattern error gracefully', async () => {
      mockRedis.keys.mockRejectedValue(new Error('Redis error'));

      await expect(cacheService.invalidatePattern('test:*')).resolves.not.toThrow();
    });
  });

  describe('Hot data methods', () => {
    beforeEach(async () => {
      (RedisClient.getInstance as jest.Mock).mockResolvedValue(mockRedis);
      await cacheService.initialize();
    });

    it('should get and set hot posts', async () => {
      const posts = [{ id: '1', title: 'Test Post' }];
      
      await cacheService.setHotPosts('forum-123', posts);
      
      expect(mockRedis.setEx).toHaveBeenCalledWith(
        CacheKeys.POST_HOT('forum-123'),
        CacheTTL.SHORT,
        JSON.stringify(posts)
      );
    });

    it('should get and set trending forums', async () => {
      const forums = [{ id: '1', name: 'Test Forum' }];
      
      await cacheService.setTrendingForums(forums);
      
      expect(mockRedis.setEx).toHaveBeenCalledWith(
        CacheKeys.FORUM_TRENDING,
        CacheTTL.SHORT,
        JSON.stringify(forums)
      );
    });

    it('should get and set agent stats', async () => {
      const stats = { postCount: 10, reputation: 100 };
      
      await cacheService.setAgentStats('agent-123', stats);
      
      expect(mockRedis.setEx).toHaveBeenCalledWith(
        CacheKeys.AGENT_STATS('agent-123'),
        CacheTTL.MEDIUM,
        JSON.stringify(stats)
      );
    });
  });

  describe('Invalidation methods', () => {
    beforeEach(async () => {
      (RedisClient.getInstance as jest.Mock).mockResolvedValue(mockRedis);
      await cacheService.initialize();
      mockRedis.keys.mockResolvedValue(['key1', 'key2']);
    });

    it('should invalidate agent caches', async () => {
      await cacheService.invalidateAgent('agent-123');

      expect(mockRedis.keys).toHaveBeenCalledWith('agent:agent-123:*');
    });

    it('should invalidate forum caches', async () => {
      await cacheService.invalidateForum('forum-123');

      expect(mockRedis.keys).toHaveBeenCalledWith('forum:forum-123:*');
    });

    it('should invalidate post cache', async () => {
      await cacheService.invalidatePost('post-123');

      expect(mockRedis.del).toHaveBeenCalledWith(CacheKeys.POST_DETAIL('post-123'));
    });

    it('should invalidate trending data', async () => {
      await cacheService.invalidateTrending();

      expect(mockRedis.del).toHaveBeenCalledWith(CacheKeys.FORUM_TRENDING);
    });
  });

  describe('Cache statistics', () => {
    beforeEach(async () => {
      (RedisClient.getInstance as jest.Mock).mockResolvedValue(mockRedis);
      await cacheService.initialize();
    });

    it('should calculate hit rate correctly', async () => {
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({ data: 'test' })); // hit
      mockRedis.get.mockResolvedValueOnce(null); // miss
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({ data: 'test' })); // hit

      await cacheService.get('key1');
      await cacheService.get('key2');
      await cacheService.get('key3');

      const stats = await cacheService.getStats();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(66.67, 1);
    });

    it('should return 0 hit rate when no operations', async () => {
      const stats = await cacheService.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('should reset statistics', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ data: 'test' }));
      
      await cacheService.get('key1');
      await cacheService.resetStats();
      
      const stats = await cacheService.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('flush', () => {
    beforeEach(async () => {
      (RedisClient.getInstance as jest.Mock).mockResolvedValue(mockRedis);
      await cacheService.initialize();
    });

    it('should flush all cache data', async () => {
      await cacheService.flush();

      expect(mockRedis.flushDb).toHaveBeenCalled();
    });

    it('should handle flush error gracefully', async () => {
      mockRedis.flushDb.mockRejectedValue(new Error('Redis error'));

      await expect(cacheService.flush()).resolves.not.toThrow();
    });
  });

  describe('CacheKeys', () => {
    it('should generate correct forum keys', () => {
      expect(CacheKeys.FORUM_DETAIL('forum-123')).toBe('forum:forum-123:detail');
      expect(CacheKeys.FORUM_POSTS('forum-123', 'hot')).toBe('forum:forum-123:posts:hot');
    });

    it('should generate correct post keys', () => {
      expect(CacheKeys.POST_HOT('forum-123')).toBe('forum:forum-123:posts:hot');
      expect(CacheKeys.POST_DETAIL('post-123')).toBe('post:post-123:detail');
    });

    it('should generate correct agent keys', () => {
      expect(CacheKeys.AGENT_STATS('agent-123')).toBe('agent:agent-123:stats');
      expect(CacheKeys.AGENT_PROFILE('agent-123')).toBe('agent:agent-123:profile');
    });
  });

  describe('CacheTTL', () => {
    it('should have correct TTL values', () => {
      expect(CacheTTL.SHORT).toBe(300);
      expect(CacheTTL.MEDIUM).toBe(3600);
      expect(CacheTTL.LONG).toBe(86400);
      expect(CacheTTL.STATS).toBe(21600);
    });
  });
});
