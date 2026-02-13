import Bull, { Queue, Job } from 'bull';
import { Pool } from 'pg';
import { logger } from '@config/logger';
import { env } from '@config/env';
import { NotificationService } from './notification.service';
import { WebSocketService } from './websocket.service';
import { CreateNotificationData, Notification } from './notification.types';

/**
 * Job types for the notification queue
 */
export interface NotificationJob {
  type: 'create' | 'send';
  data: CreateNotificationData | Notification;
}

/**
 * Parse Redis connection URL once
 */
function getRedisConfig(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
  };
}

/**
 * NotificationQueue manages async processing of notifications using Bull
 */
export class NotificationQueue {
  private queue: Queue<NotificationJob>;
  private notificationService: NotificationService;
  private wsService?: WebSocketService;

  constructor(pool: Pool, wsService?: WebSocketService) {
    this.notificationService = new NotificationService(pool);
    this.wsService = wsService;

    // Initialize Bull queue with Redis
    const redisConfig = env.REDIS_URL
      ? getRedisConfig(env.REDIS_URL)
      : { host: 'localhost', port: 6379 };

    this.queue = new Bull<NotificationJob>('notifications', {
      redis: redisConfig,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 500, // Keep last 500 failed jobs for debugging
      },
    });

    this.setupProcessors();
    this.setupEventHandlers();

    logger.info('Notification queue initialized');
  }

  /**
   * Setup job processors
   */
  private setupProcessors(): void {
    // Process notification creation jobs
    this.queue.process('create', 5, async (job: Job<NotificationJob>) => {
      try {
        logger.debug(`Processing notification creation job ${job.id}`);

        const notificationData = job.data.data as CreateNotificationData;
        const notification = await this.notificationService.createNotification(notificationData);

        // After creating, send via WebSocket if available
        if (this.wsService) {
          await this.wsService.sendNotificationToAgent(notification.recipientId, notification);
        }

        logger.info(`Notification created and sent: ${notification.id}`);
        return { success: true, notificationId: notification.id };
      } catch (error) {
        logger.error(`Error processing notification creation job ${job.id}:`, error);
        throw error;
      }
    });

    // Process notification send jobs (for already created notifications)
    this.queue.process('send', 10, async (job: Job<NotificationJob>) => {
      try {
        logger.debug(`Processing notification send job ${job.id}`);

        const notification = job.data.data as Notification;

        if (this.wsService) {
          const sent = await this.wsService.sendNotificationToAgent(
            notification.recipientId,
            notification,
          );

          if (!sent) {
            logger.debug(`Agent ${notification.recipientId} not connected, notification queued`);
          }
        }

        return { success: true, notificationId: notification.id };
      } catch (error) {
        logger.error(`Error processing notification send job ${job.id}:`, error);
        throw error;
      }
    });
  }

  /**
   * Setup event handlers for queue monitoring
   */
  private setupEventHandlers(): void {
    this.queue.on('completed', (job: Job, result: any) => {
      logger.debug(`Notification job ${job.id} completed:`, result);
    });

    this.queue.on('failed', (job: Job, error: Error) => {
      logger.error(`Notification job ${job.id} failed:`, error);
    });

    this.queue.on('stalled', (job: Job) => {
      logger.warn(`Notification job ${job.id} stalled`);
    });

    this.queue.on('error', (error: Error) => {
      logger.error('Queue error:', error);
    });
  }

  /**
   * Queue a notification for creation
   */
  async queueNotification(
    data: CreateNotificationData,
    priority?: number,
  ): Promise<Job<NotificationJob>> {
    try {
      const job = await this.queue.add(
        'create',
        { type: 'create', data },
        {
          priority: priority || 5, // Lower number = higher priority
        },
      );

      logger.debug(`Notification queued for creation: job ${job.id}`);
      return job;
    } catch (error) {
      logger.error('Error queueing notification:', error);
      throw error;
    }
  }

  /**
   * Queue multiple notifications for creation
   */
  async queueNotifications(
    notifications: CreateNotificationData[],
    priority?: number,
  ): Promise<Job<NotificationJob>[]> {
    try {
      const jobs = await this.queue.addBulk(
        notifications.map((data) => ({
          name: 'create',
          data: { type: 'create', data } as NotificationJob,
          opts: {
            priority: priority || 5,
          },
        })),
      );

      logger.debug(`${jobs.length} notifications queued for creation`);
      return jobs;
    } catch (error) {
      logger.error('Error queueing bulk notifications:', error);
      throw error;
    }
  }

  /**
   * Queue an existing notification for sending
   */
  async queueNotificationSend(
    notification: Notification,
    priority?: number,
  ): Promise<Job<NotificationJob>> {
    try {
      const job = await this.queue.add(
        'send',
        { type: 'send', data: notification },
        {
          priority: priority || 5,
        },
      );

      logger.debug(`Notification queued for sending: job ${job.id}`);
      return job;
    } catch (error) {
      logger.error('Error queueing notification send:', error);
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Pause the queue
   */
  async pause(): Promise<void> {
    await this.queue.pause();
    logger.info('Notification queue paused');
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    await this.queue.resume();
    logger.info('Notification queue resumed');
  }

  /**
   * Clean old jobs from the queue
   */
  async cleanOldJobs(gracePeriod: number = 86400000): Promise<void> {
    // Clean jobs older than gracePeriod (default: 24 hours)
    await this.queue.clean(gracePeriod, 'completed');
    await this.queue.clean(gracePeriod, 'failed');
    logger.info('Old notification jobs cleaned');
  }

  /**
   * Close the queue
   */
  async close(): Promise<void> {
    await this.queue.close();
    logger.info('Notification queue closed');
  }

  /**
   * Get the queue instance
   */
  getQueue(): Queue<NotificationJob> {
    return this.queue;
  }
}
