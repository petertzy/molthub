import { performance } from 'perf_hooks';
import { pool } from '../../src/config/database';
import { cacheService } from '../../src/shared/cache';
import { monitoredQuery } from '../../src/shared/database';

/**
 * Performance benchmark tests
 */
describe('Performance Benchmarks', () => {
  beforeAll(async () => {
    await cacheService.initialize();
  });

  describe('Database Query Performance', () => {
    it('should execute simple SELECT query within acceptable time', async () => {
      const start = performance.now();
      
      await monitoredQuery(pool, 'SELECT 1 as test');
      
      const duration = performance.now() - start;
      
      // Should complete in less than 10ms for simple query
      expect(duration).toBeLessThan(10);
    });

    it('should execute query with WHERE clause efficiently', async () => {
      const start = performance.now();
      
      await monitoredQuery(
        pool,
        'SELECT * FROM agents WHERE id = $1 LIMIT 1',
        ['00000000-0000-0000-0000-000000000000']
      );
      
      const duration = performance.now() - start;
      
      // Should complete in less than 50ms
      expect(duration).toBeLessThan(50);
    });

    it('should handle bulk queries efficiently', async () => {
      const iterations = 10;
      const start = performance.now();
      
      const promises = Array(iterations).fill(null).map(() => 
        monitoredQuery(pool, 'SELECT 1')
      );
      await Promise.all(promises);
      
      const duration = performance.now() - start;
      const avgDuration = duration / iterations;
      
      // Average should be less than 10ms per query
      expect(avgDuration).toBeLessThan(10);
    });
  });

  describe('Cache Performance', () => {
    it('should write to cache within acceptable time', async () => {
      const testKey = 'benchmark:write:test';
      const testValue = { data: 'test', timestamp: Date.now() };
      
      const start = performance.now();
      await cacheService.set(testKey, testValue, 60);
      const duration = performance.now() - start;
      
      // Should complete in less than 5ms
      expect(duration).toBeLessThan(5);
      
      // Clean up
      await cacheService.delete(testKey);
    });

    it('should read from cache within acceptable time', async () => {
      const testKey = 'benchmark:read:test';
      const testValue = { data: 'test', timestamp: Date.now() };
      
      // Setup
      await cacheService.set(testKey, testValue, 60);
      
      const start = performance.now();
      const result = await cacheService.get(testKey);
      const duration = performance.now() - start;
      
      // Should complete in less than 5ms
      expect(duration).toBeLessThan(5);
      expect(result).toEqual(testValue);
      
      // Clean up
      await cacheService.delete(testKey);
    });

    it('should handle cache miss within acceptable time', async () => {
      const testKey = 'benchmark:miss:nonexistent';
      
      const start = performance.now();
      const result = await cacheService.get(testKey);
      const duration = performance.now() - start;
      
      // Should complete in less than 5ms
      expect(duration).toBeLessThan(5);
      expect(result).toBeNull();
    });

    it('should handle bulk cache operations efficiently', async () => {
      const iterations = 20;
      const keys = Array(iterations).fill(null).map((_, i) => `benchmark:bulk:${i}`);
      const value = { test: 'data' };
      
      // Bulk write
      const writeStart = performance.now();
      await Promise.all(keys.map(key => cacheService.set(key, value, 60)));
      const writeDuration = performance.now() - writeStart;
      
      // Bulk read
      const readStart = performance.now();
      await Promise.all(keys.map(key => cacheService.get(key)));
      const readDuration = performance.now() - readStart;
      
      // Average write should be less than 5ms per operation
      expect(writeDuration / iterations).toBeLessThan(5);
      
      // Average read should be less than 5ms per operation
      expect(readDuration / iterations).toBeLessThan(5);
      
      // Clean up
      await Promise.all(keys.map(key => cacheService.delete(key)));
    });
  });

  describe('Connection Pool Performance', () => {
    it('should maintain healthy pool metrics', async () => {
      // Get initial metrics
      const initialTotal = pool.totalCount;
      const initialIdle = pool.idleCount;
      
      // Execute some queries
      const queries = Array(5).fill(null).map(() => 
        monitoredQuery(pool, 'SELECT pg_sleep(0.01)')
      );
      await Promise.all(queries);
      
      // Wait for connections to be released
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check pool recovered
      const finalIdle = pool.idleCount;
      
      // Should have idle connections available
      expect(finalIdle).toBeGreaterThan(0);
      expect(pool.waitingCount).toBe(0);
    });
  });

  describe('Overall System Performance', () => {
    it('should handle mixed operations efficiently', async () => {
      const iterations = 10;
      const start = performance.now();
      
      // Mix of database and cache operations
      const operations = [];
      for (let i = 0; i < iterations; i++) {
        operations.push(
          monitoredQuery(pool, 'SELECT 1'),
          cacheService.set(`benchmark:mixed:${i}`, { i }, 60),
          cacheService.get(`benchmark:mixed:${i}`)
        );
      }
      
      await Promise.all(operations);
      const duration = performance.now() - start;
      
      // Should handle all operations in reasonable time
      expect(duration).toBeLessThan(500);
      
      // Clean up
      for (let i = 0; i < iterations; i++) {
        await cacheService.delete(`benchmark:mixed:${i}`);
      }
    });
  });

  describe('Query Optimization', () => {
    it('should use indexes effectively', async () => {
      // This test would need actual data, but demonstrates the pattern
      const start = performance.now();
      
      // Query that should use index
      await monitoredQuery(
        pool,
        'SELECT * FROM agents WHERE name = $1 LIMIT 1',
        ['test-agent']
      );
      
      const duration = performance.now() - start;
      
      // Indexed query should be fast
      expect(duration).toBeLessThan(50);
    });
  });
});
