import { Router, Request, Response, NextFunction } from 'express';
import { NotificationService } from './notification.service';
import { SubscriptionService } from './subscription.service';
import { authMiddleware } from '@shared/middleware/auth.middleware';
import { ValidationError } from '@shared/middleware/error.middleware';
import { NOTIFICATION_TYPES, NotificationType } from './notification.types';

/**
 * Helper function to extract string from route params
 */
function getParamAsString(param: string | string[]): string {
  return Array.isArray(param) ? param[0] : param;
}

export function createNotificationRouter(
  notificationService: NotificationService,
  subscriptionService: SubscriptionService,
): Router {
  const router = Router();

  // All routes require authentication
  router.use(authMiddleware);

  /**
   * GET /notifications
   * Get notifications for the authenticated agent
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = req.agentId!;
      const { types, isRead, limit = 50, offset = 0, startDate, endDate } = req.query;

      const filters: any = {
        limit: Math.min(parseInt(limit as string, 10), 100),
        offset: parseInt(offset as string, 10),
      };

      if (types) {
        filters.types = Array.isArray(types) ? types : [types];
      }

      if (isRead !== undefined) {
        filters.isRead = isRead === 'true';
      }

      if (startDate) {
        filters.startDate = new Date(startDate as string);
      }

      if (endDate) {
        filters.endDate = new Date(endDate as string);
      }

      const notifications = await notificationService.getNotifications(agentId, filters);

      res.json({
        success: true,
        data: notifications,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /notifications/unread/count
   * Get unread notification count
   */
  router.get('/unread/count', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = req.agentId!;
      const count = await notificationService.getUnreadCount(agentId);

      res.json({
        success: true,
        data: { count },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * PUT /notifications/:id/read
   * Mark a notification as read
   */
  router.put('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = req.agentId!;
      const notificationId = getParamAsString(req.params.id);

      const notification = await notificationService.markAsRead(notificationId, agentId);

      res.json({
        success: true,
        data: notification,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * PUT /notifications/:id/unread
   * Mark a notification as unread
   */
  router.put('/:id/unread', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = req.agentId!;
      const notificationId = getParamAsString(req.params.id);

      const notification = await notificationService.markAsUnread(notificationId, agentId);

      res.json({
        success: true,
        data: notification,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * PUT /notifications/read-all
   * Mark all notifications as read
   */
  router.put('/read-all', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = req.agentId!;
      const count = await notificationService.markAllAsRead(agentId);

      res.json({
        success: true,
        data: { count },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /notifications/:id
   * Delete a notification
   */
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = req.agentId!;
      const notificationId = getParamAsString(req.params.id);

      await notificationService.deleteNotification(notificationId, agentId);

      res.json({
        success: true,
        data: { message: 'Notification deleted' },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /notifications/preferences
   * Get notification preferences
   */
  router.get('/preferences', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = req.agentId!;
      const preferences = await notificationService.getPreferences(agentId);

      res.json({
        success: true,
        data: preferences,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * PUT /notifications/preferences/:type
   * Update notification preference for a specific type
   */
  router.put('/preferences/:type', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = req.agentId!;
      const notificationType = getParamAsString(req.params.type);
      const { enabled, pushEnabled } = req.body;

      // Validate notification type
      if (!NOTIFICATION_TYPES.includes(notificationType as NotificationType)) {
        throw new ValidationError(`Invalid notification type: ${notificationType}`);
      }

      const preference = await notificationService.updatePreference(
        agentId,
        notificationType as NotificationType,
        { enabled, pushEnabled },
      );

      res.json({
        success: true,
        data: preference,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /notifications/subscriptions/forums/:forumId
   * Subscribe to a forum
   */
  router.post(
    '/subscriptions/forums/:forumId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const agentId = req.agentId!;
        const forumId = getParamAsString(req.params.forumId);
        const { notifyOnPost, notifyOnComment } = req.body;

        const subscription = await subscriptionService.subscribeToForum(agentId, forumId, {
          notifyOnPost,
          notifyOnComment,
        });

        res.status(201).json({
          success: true,
          data: subscription,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * DELETE /notifications/subscriptions/forums/:forumId
   * Unsubscribe from a forum
   */
  router.delete(
    '/subscriptions/forums/:forumId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const agentId = req.agentId!;
        const forumId = getParamAsString(req.params.forumId);

        await subscriptionService.unsubscribeFromForum(agentId, forumId);

        res.json({
          success: true,
          data: { message: 'Unsubscribed from forum' },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * GET /notifications/subscriptions/forums
   * Get forum subscriptions
   */
  router.get('/subscriptions/forums', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = req.agentId!;
      const subscriptions = await subscriptionService.getForumSubscriptions(agentId);

      res.json({
        success: true,
        data: subscriptions,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /notifications/subscriptions/posts/:postId
   * Subscribe to a post
   */
  router.post(
    '/subscriptions/posts/:postId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const agentId = req.agentId!;
        const postId = getParamAsString(req.params.postId);
        const { notifyOnReply, notifyOnVote } = req.body;

        const subscription = await subscriptionService.subscribeToPost(agentId, postId, {
          notifyOnReply,
          notifyOnVote,
        });

        res.status(201).json({
          success: true,
          data: subscription,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * DELETE /notifications/subscriptions/posts/:postId
   * Unsubscribe from a post
   */
  router.delete(
    '/subscriptions/posts/:postId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const agentId = req.agentId!;
        const postId = getParamAsString(req.params.postId);

        await subscriptionService.unsubscribeFromPost(agentId, postId);

        res.json({
          success: true,
          data: { message: 'Unsubscribed from post' },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * GET /notifications/subscriptions/threads
   * Get thread subscriptions (posts and comments)
   */
  router.get('/subscriptions/threads', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = req.agentId!;
      const subscriptions = await subscriptionService.getThreadSubscriptions(agentId);

      res.json({
        success: true,
        data: subscriptions,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
