import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { testConnection, closePool, pool } from './config/database';
import { cacheService } from '@shared/cache';
import { getCacheWarmer } from '@shared/cache/cache-warmer.service';
import RedisClient from './config/redis';
import { WebSocketService } from './modules/notifications/websocket.service';
import { NotificationQueue } from './modules/notifications/notification.queue';
import { ReputationJobService } from './modules/agents/reputation-job.service';
import { startPoolMetricsCollection } from './shared/database';
import { createServer } from 'http';
import { createGraphQLServer, createGraphQLMiddleware } from './modules/graphql/server';
import { initializeSentry } from './config/sentry';

async function bootstrap() {
  try {
    // Initialize Sentry for error tracking
    initializeSentry();

    // Log startup information
    logger.info('Starting MoltHub API Server', {
      environment: env.NODE_ENV,
      port: env.PORT,
      apiVersion: env.API_VERSION,
    });

    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.error('Failed to connect to database. Exiting...');
      process.exit(1);
    }

    // Initialize cache service
    await cacheService.initialize();
    if (cacheService.isAvailable()) {
      logger.info('Cache service initialized successfully');

      // Warm cache with hot data
      try {
        const cacheWarmer = getCacheWarmer(pool);
        await cacheWarmer.warmAll();
        logger.info('Cache warming completed');
      } catch (error) {
        logger.warn('Cache warming failed, continuing without cache', { error });
      }
    } else {
      logger.warn('Cache service not available, running without cache');
    }

    // Create Express application
    const app = createApp();

    // Create HTTP server
    const httpServer = createServer(app);

    // Initialize GraphQL server
    const graphqlServer = await createGraphQLServer({ pool, httpServer });
    const graphqlMiddleware = createGraphQLMiddleware({ pool, server: graphqlServer });
    app.use(`/api/${env.API_VERSION}/graphql`, graphqlMiddleware);
    logger.info('GraphQL server initialized');
    logger.info(`GraphQL endpoint: http://localhost:${env.PORT}/api/${env.API_VERSION}/graphql`);

    // Initialize WebSocket service
    const wsService = new WebSocketService(httpServer);
    logger.info('WebSocket service initialized');

    // Initialize notification queue
    let notificationQueue: NotificationQueue | undefined;
    try {
      notificationQueue = new NotificationQueue(pool, wsService);
      logger.info('Notification queue initialized');
    } catch (error) {
      logger.warn(
        'Failed to initialize notification queue, notifications will be processed synchronously',
        { error },
      );
    }

    // Start server
    const server = httpServer.listen(env.PORT, () => {
      logger.info(`Server is running on port ${env.PORT}`);
      logger.info(`Health check: http://localhost:${env.PORT}/health`);
      logger.info(`API base URL: http://localhost:${env.PORT}/api/${env.API_VERSION}`);
      logger.info(`WebSocket endpoint: ws://localhost:${env.PORT}/ws/notifications`);
    });

    // Start reputation background job (runs every 6 hours)
    const reputationJobService = new ReputationJobService(pool);
    reputationJobService.start(6);
    logger.info('Reputation recalculation job started');

    // Start database pool metrics collection (every 30 seconds)
    const poolMetricsInterval = startPoolMetricsCollection(pool, 30000);
    logger.info('Database pool metrics collection started');

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);

      server.close(async () => {
        logger.info('HTTP server closed');

        // Stop GraphQL server
        await graphqlServer.stop();
        logger.info('GraphQL server stopped');

        // Stop pool metrics collection
        clearInterval(poolMetricsInterval);

        // Close notification queue
        if (notificationQueue) {
          await notificationQueue.close();
        }

        // Close WebSocket service
        await wsService.close();

        // Close database pool
        await closePool();

        // Close Redis connection
        await RedisClient.disconnect();

        logger.info('Graceful shutdown completed');
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: any) => {
      logger.error('Unhandled rejection', { reason });
      process.exit(1);
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

bootstrap();
