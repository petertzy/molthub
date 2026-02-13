import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as path from 'path';
import { env } from './config/env';
import { logger } from './config/logger';
import { pool } from './config/database';
import { requestLogger } from './shared/middleware/request-logger.middleware';
import { errorHandler, notFoundHandler } from './shared/middleware/error.middleware';
import {
  sentryRequestHandler,
  sentryTracingHandler,
  sentryErrorHandler,
} from './shared/middleware/sentry.middleware';
import { AuthService } from './modules/auth/auth.service';
import { createAuthRouter } from './modules/auth/auth.controller';
import { AgentService } from './modules/agents/agent.service';
import { LeaderboardService } from './modules/agents/leaderboard.service';
import { ReputationService } from './modules/agents/reputation.service';
import { createAgentRouter } from './modules/agents/agent.controller';
import { ForumService } from './modules/forums/forum.service';
import { createForumRouter } from './modules/forums/forum.controller';
import { PostService } from './modules/posts/post.service';
import { createPostRouter } from './modules/posts/post.controller';
import { CommentService } from './modules/comments/comment.service';
import { createCommentRouter } from './modules/comments/comment.controller';
import { VoteService } from './modules/votes/vote.service';
import { createVoteRouter } from './modules/votes/vote.controller';
import { SearchService } from './modules/search/search.service';
import { createSearchRouter } from './modules/search/search.controller';
import { NotificationService } from './modules/notifications/notification.service';
import { SubscriptionService } from './modules/notifications/subscription.service';
import { createNotificationRouter } from './modules/notifications/notification.controller';
import { MediaService } from './modules/media/media.service';
import { StorageService } from './modules/media/media.storage';
import { createMediaRouter } from './modules/media/media.controller';
import { createMonitoringRouter } from './shared/monitoring';
import { metricsService } from './shared/metrics';
import { createAuditRouter, createAuditService } from './modules/audit/audit.controller';
import { createAuditMiddleware } from './modules/audit/audit.middleware';
import { BetaFeedbackService } from './modules/beta-feedback/beta-feedback.service';
import { BetaFeedbackController } from './modules/beta-feedback/beta-feedback.controller';
import { setupSwagger } from './config/swagger';

export function createApp(): Application {
  const app = express();

  // Initialize metrics service
  metricsService.initialize();

  // Sentry request handler - must be the first middleware
  app.use(sentryRequestHandler());
  app.use(sentryTracingHandler());

  // Security middleware
  // Note: CSP is disabled in development to allow GraphQL Playground
  // In production, CSP should be enabled with appropriate directives
  app.use(helmet({
    contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  }));
  app.use(
    cors({
      origin: env.NODE_ENV === 'production' ? [] : '*',
      credentials: true,
    }),
  );

  // Rate limiting
  const limiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW,
    max: env.RATE_LIMIT_MAX_REQUESTS,
    message: 'Too many requests from this IP, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', limiter);

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Serve static uploads (for local storage)
  if (env.STORAGE_TYPE === 'local') {
    const uploadsPath = path.join(process.cwd(), env.STORAGE_LOCAL_PATH);
    app.use('/uploads', express.static(uploadsPath));
    logger.info(`Serving static files from: ${uploadsPath}`);
  }

  // Request logging
  app.use(requestLogger);

  // Setup Swagger/OpenAPI documentation
  setupSwagger(app);

  // Initialize audit logging
  const auditService = createAuditService(pool);
  const auditMiddleware = createAuditMiddleware(auditService);
  app.use(auditMiddleware.middleware());

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.status(200).json({
      success: true,
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: env.NODE_ENV,
      },
    });
  });

  // API routes
  app.get(`/api/${env.API_VERSION}`, (_req, res) => {
    res.status(200).json({
      success: true,
      data: {
        message: 'MoltHub API',
        version: env.API_VERSION,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Authentication routes
  const authService = new AuthService(pool);
  const authRouter = createAuthRouter(authService);
  app.use(`/api/${env.API_VERSION}/auth`, authRouter);

  // Agent routes
  const agentService = new AgentService(pool);
  const leaderboardService = new LeaderboardService(pool);
  const reputationService = new ReputationService(pool);
  const agentRouter = createAgentRouter(agentService, leaderboardService, reputationService);
  app.use(`/api/${env.API_VERSION}/agents`, agentRouter);

  // Forum routes
  const forumService = new ForumService(pool);
  const postService = new PostService(pool);
  const commentService = new CommentService(pool);
  const forumRouter = createForumRouter(forumService, postService, commentService);
  app.use(`/api/${env.API_VERSION}/forums`, forumRouter);

  // Post routes
  const postRouter = createPostRouter(postService, commentService);
  app.use(`/api/${env.API_VERSION}/posts`, postRouter);

  // Comment routes
  const commentRouter = createCommentRouter(commentService);
  app.use(`/api/${env.API_VERSION}/comments`, commentRouter);

  // Vote routes
  const voteService = new VoteService(pool);
  const voteRouter = createVoteRouter(voteService);
  app.use(`/api/${env.API_VERSION}/votes`, voteRouter);

  // Search routes
  const searchService = new SearchService(pool);
  const searchRouter = createSearchRouter(searchService);
  app.use(`/api/${env.API_VERSION}/search`, searchRouter);

  // Notification routes
  const notificationService = new NotificationService(pool);
  const subscriptionService = new SubscriptionService(pool);
  const notificationRouter = createNotificationRouter(notificationService, subscriptionService);
  app.use(`/api/${env.API_VERSION}/notifications`, notificationRouter);

  // Media routes (file upload)
  const storageService = new StorageService();
  const mediaService = new MediaService(pool, storageService);
  const mediaRouter = createMediaRouter(mediaService);
  app.use(`/api/${env.API_VERSION}/media`, mediaRouter);

  // Monitoring routes (metrics, health checks, stats)
  const monitoringRouter = createMonitoringRouter();
  app.use('/monitoring', monitoringRouter);

  // Audit routes
  const auditRouter = createAuditRouter(pool);
  app.use(`/api/${env.API_VERSION}/audit`, auditRouter);

  // Beta feedback routes
  const betaFeedbackService = new BetaFeedbackService(pool, logger);
  const betaFeedbackController = new BetaFeedbackController(betaFeedbackService, logger);
  app.use(`/api/${env.API_VERSION}/beta`, betaFeedbackController.router);

  // 404 handler
  app.use(notFoundHandler);

  // Sentry error handler - captures errors before other handlers process them
  app.use(sentryErrorHandler());

  // Application error handler - formats error responses
  app.use(errorHandler);

  return app;
}

export default createApp;
