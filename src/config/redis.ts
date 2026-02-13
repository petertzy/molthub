import { createClient, RedisClientType } from 'redis';
import { env } from '@config/env';
import { logger } from '@config/logger';

// Constants
const CONNECTION_CHECK_INTERVAL_MS = 100;
const MAX_CONNECTION_RETRIES = 50; // 5 seconds max wait

class RedisClient {
  private static instance: RedisClientType | null = null;
  private static connecting = false;
  private static connectionAttempts = 0;

  static async getInstance(): Promise<RedisClientType | null> {
    if (this.instance) {
      return this.instance;
    }

    if (this.connecting) {
      // Wait for connection to complete with retry limit
      if (this.connectionAttempts >= MAX_CONNECTION_RETRIES) {
        logger.warn('Redis connection timeout - max retries exceeded');
        this.connecting = false;
        this.connectionAttempts = 0;
        return null;
      }

      this.connectionAttempts++;
      await new Promise((resolve) => setTimeout(resolve, CONNECTION_CHECK_INTERVAL_MS));
      return this.getInstance();
    }

    this.connecting = true;
    this.connectionAttempts = 0;

    try {
      this.instance = createClient({ url: env.REDIS_URL });
      this.instance.on('error', (err) => logger.error('Redis Client Error', { error: err }));
      await this.instance.connect();
      logger.info('Redis client connected');
      this.connecting = false;
      return this.instance;
    } catch (error) {
      logger.warn('Failed to connect to Redis, caching disabled', { error });
      this.connecting = false;
      return null;
    }
  }

  static async disconnect() {
    if (this.instance) {
      await this.instance.disconnect();
      this.instance = null;
      logger.info('Redis client disconnected');
    }
  }
}

export default RedisClient;
