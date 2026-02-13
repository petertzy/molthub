import { MetricsService } from '../../src/shared/metrics/metrics.service';

describe('MetricsService', () => {
  let metricsService: MetricsService;

  beforeEach(() => {
    metricsService = new MetricsService();
  });

  describe('initialization', () => {
    it('should initialize successfully', () => {
      metricsService.initialize();
      const registry = metricsService.getRegistry();
      expect(registry).toBeDefined();
    });

    it('should not reinitialize if already initialized', () => {
      metricsService.initialize();
      metricsService.initialize();
      // Should not throw error
      expect(metricsService.getRegistry()).toBeDefined();
    });
  });

  describe('recordHttpRequest', () => {
    beforeEach(() => {
      metricsService.initialize();
    });

    it('should record HTTP request metrics', () => {
      const method = 'GET';
      const route = '/api/v1/agents';
      const statusCode = 200;
      const duration = 0.05;

      expect(() => {
        metricsService.recordHttpRequest(method, route, statusCode, duration);
      }).not.toThrow();
    });

    it('should handle multiple requests', () => {
      for (let i = 0; i < 10; i++) {
        metricsService.recordHttpRequest('GET', '/api/v1/test', 200, 0.01);
      }
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('recordHttpError', () => {
    beforeEach(() => {
      metricsService.initialize();
    });

    it('should record HTTP error metrics', () => {
      expect(() => {
        metricsService.recordHttpError('GET', '/api/v1/test', 'server_error');
      }).not.toThrow();
    });
  });

  describe('recordDbQuery', () => {
    beforeEach(() => {
      metricsService.initialize();
    });

    it('should record database query metrics', () => {
      expect(() => {
        metricsService.recordDbQuery('SELECT', 'agents', 0.01, false);
      }).not.toThrow();
    });

    it('should record slow query metrics', () => {
      expect(() => {
        metricsService.recordDbQuery('SELECT', 'posts', 1.5, true);
      }).not.toThrow();
    });
  });

  describe('updateDbPoolMetrics', () => {
    beforeEach(() => {
      metricsService.initialize();
    });

    it('should update connection pool metrics', () => {
      expect(() => {
        metricsService.updateDbPoolMetrics(20, 15, 2);
      }).not.toThrow();
    });

    it('should handle zero values', () => {
      expect(() => {
        metricsService.updateDbPoolMetrics(0, 0, 0);
      }).not.toThrow();
    });
  });

  describe('cache metrics', () => {
    beforeEach(() => {
      metricsService.initialize();
    });

    it('should record cache hit', () => {
      expect(() => {
        metricsService.recordCacheHit('agent');
      }).not.toThrow();
    });

    it('should record cache miss', () => {
      expect(() => {
        metricsService.recordCacheMiss('forum');
      }).not.toThrow();
    });

    it('should record cache operation duration', () => {
      expect(() => {
        metricsService.recordCacheOperation('get', 'post', 0.001);
      }).not.toThrow();
    });
  });

  describe('extractKeyPrefix', () => {
    it('should extract prefix from cache key', () => {
      const key = 'forum:123:posts:hot';
      const prefix = metricsService.extractKeyPrefix(key);
      expect(prefix).toBe('forum');
    });

    it('should handle simple keys', () => {
      const key = 'simple';
      const prefix = metricsService.extractKeyPrefix(key);
      expect(prefix).toBe('simple');
    });

    it('should handle empty keys', () => {
      const key = '';
      const prefix = metricsService.extractKeyPrefix(key);
      expect(prefix).toBe('unknown');
    });
  });

  describe('getMetrics', () => {
    beforeEach(() => {
      metricsService.initialize();
    });

    it('should return metrics in Prometheus format', async () => {
      // Record some metrics
      metricsService.recordHttpRequest('GET', '/test', 200, 0.01);
      metricsService.recordCacheHit('test');

      const metrics = await metricsService.getMetrics();
      
      expect(typeof metrics).toBe('string');
      expect(metrics.length).toBeGreaterThan(0);
    });

    it('should include default Node.js metrics', async () => {
      const metrics = await metricsService.getMetrics();
      
      // Should include Node.js default metrics
      expect(metrics).toContain('moltbook_');
    });
  });
});
