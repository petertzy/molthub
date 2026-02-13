import { Router, Request, Response } from 'express';
import { metricsService } from '@shared/metrics';
import { pool } from '@config/database';
import { cacheService } from '@shared/cache';
import { logger } from '@config/logger';

/**
 * Create monitoring router
 */
export function createMonitoringRouter(): Router {
  const router = Router();

  /**
   * GET /metrics
   * Prometheus metrics endpoint
   */
  router.get('/metrics', async (_req: Request, res: Response) => {
    try {
      const metrics = await metricsService.getMetrics();
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.send(metrics);
    } catch (error) {
      logger.error('Error getting metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve metrics',
      });
    }
  });

  /**
   * GET /health/detailed
   * Detailed health check with component status
   */
  router.get('/health/detailed', async (_req: Request, res: Response) => {
    try {
      // Check database
      let dbStatus = 'unhealthy';
      let dbLatency = 0;
      try {
        const start = Date.now();
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        dbLatency = Date.now() - start;
        dbStatus = 'healthy';
      } catch (error) {
        logger.error('Database health check failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // Check cache
      const cacheStatus = cacheService.isAvailable() ? 'healthy' : 'unavailable';
      const cacheStats = await cacheService.getStats();

      // Get database pool stats
      const poolStats = {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
        active: pool.totalCount - pool.idleCount,
      };

      // Overall status
      const isHealthy = dbStatus === 'healthy';
      const status = isHealthy ? 'healthy' : 'unhealthy';

      res.status(isHealthy ? 200 : 503).json({
        success: true,
        data: {
          status,
          timestamp: new Date().toISOString(),
          components: {
            database: {
              status: dbStatus,
              latency: dbLatency,
              pool: poolStats,
            },
            cache: {
              status: cacheStatus,
              stats: cacheStats,
            },
          },
        },
      });
    } catch (error) {
      logger.error('Error in detailed health check', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).json({
        success: false,
        error: 'Health check failed',
      });
    }
  });

  /**
   * GET /stats
   * System statistics
   */
  router.get('/stats', async (_req: Request, res: Response) => {
    try {
      // Get cache stats
      const cacheStats = await cacheService.getStats();

      // Get database pool stats
      const poolStats = {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
        active: pool.totalCount - pool.idleCount,
      };

      // Get process stats
      const processStats = {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
      };

      res.json({
        success: true,
        data: {
          timestamp: new Date().toISOString(),
          cache: cacheStats,
          database: {
            pool: poolStats,
          },
          process: processStats,
        },
      });
    } catch (error) {
      logger.error('Error getting stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve stats',
      });
    }
  });

  return router;
}
