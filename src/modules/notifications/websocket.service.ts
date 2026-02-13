import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import { logger } from '@config/logger';
import { JwtStrategy } from '@modules/auth/jwt.strategy';
import { Notification } from './notification.types';

/**
 * WebSocketService manages real-time notification delivery via Socket.io
 */
export class WebSocketService {
  private io: Server;
  private jwtStrategy: JwtStrategy;
  private connectedAgents: Map<string, Set<string>>; // agentId -> Set of socketIds

  constructor(httpServer: HTTPServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin:
          process.env.NODE_ENV === 'production'
            ? process.env.WS_ALLOWED_ORIGINS?.split(',') || []
            : '*',
        credentials: true,
      },
      path: '/ws/notifications',
    });

    this.jwtStrategy = new JwtStrategy();
    this.connectedAgents = new Map();

    this.setupMiddleware();
    this.setupConnectionHandlers();

    logger.info('WebSocket service initialized');
  }

  /**
   * Setup authentication middleware for socket connections
   */
  private setupMiddleware(): void {
    this.io.use((socket: Socket, next) => {
      try {
        // Get token from auth header or query param
        const token =
          socket.handshake.auth.token ||
          socket.handshake.headers.authorization?.replace('Bearer ', '') ||
          socket.handshake.query.token;

        if (!token) {
          logger.warn('WebSocket connection rejected: No token provided');
          return next(new Error('Authentication required'));
        }

        // Verify token
        const decoded = this.jwtStrategy.verifyToken(token as string);

        if (!decoded || decoded.type !== 'access') {
          logger.warn('WebSocket connection rejected: Invalid token');
          return next(new Error('Invalid or expired token'));
        }

        // Attach agent ID to socket
        socket.data.agentId = decoded.sub;
        next();
      } catch (error) {
        logger.error('WebSocket authentication error:', error);
        next(new Error('Authentication failed'));
      }
    });
  }

  /**
   * Setup connection event handlers
   */
  private setupConnectionHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      const agentId = socket.data.agentId;

      if (!agentId) {
        socket.disconnect();
        return;
      }

      // Track connection
      if (!this.connectedAgents.has(agentId)) {
        this.connectedAgents.set(agentId, new Set());
      }
      this.connectedAgents.get(agentId)!.add(socket.id);

      logger.info(`Agent ${agentId} connected via WebSocket (socket: ${socket.id})`);

      // Join agent-specific room
      socket.join(`agent:${agentId}`);

      // Handle disconnection
      socket.on('disconnect', () => {
        const sockets = this.connectedAgents.get(agentId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            this.connectedAgents.delete(agentId);
          }
        }
        logger.info(`Agent ${agentId} disconnected from WebSocket (socket: ${socket.id})`);
      });

      // Handle ping for connection health check
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: Date.now() });
      });

      // Send connection confirmation
      socket.emit('connected', {
        message: 'Successfully connected to notification service',
        agentId,
        timestamp: new Date().toISOString(),
      });
    });
  }

  /**
   * Send notification to a specific agent
   */
  async sendNotificationToAgent(agentId: string, notification: Notification): Promise<boolean> {
    try {
      const room = `agent:${agentId}`;

      // Check if agent is connected
      const sockets = await this.io.in(room).fetchSockets();

      if (sockets.length === 0) {
        logger.debug(`Agent ${agentId} not connected, notification will be queued`);
        return false;
      }

      // Emit notification to the agent's room
      this.io.to(room).emit('notification', {
        type: 'new_notification',
        data: notification,
        timestamp: new Date().toISOString(),
      });

      logger.info(`Notification sent to agent ${agentId} via WebSocket`);
      return true;
    } catch (error) {
      logger.error(`Error sending notification to agent ${agentId}:`, error);
      return false;
    }
  }

  /**
   * Send bulk notifications to multiple agents
   */
  async sendNotificationsToAgents(
    notifications: Map<string, Notification[]>,
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [agentId, agentNotifications] of notifications.entries()) {
      try {
        for (const notification of agentNotifications) {
          const sent = await this.sendNotificationToAgent(agentId, notification);
          results.set(agentId, sent);
        }
      } catch (error) {
        logger.error(`Error sending notifications to agent ${agentId}:`, error);
        results.set(agentId, false);
      }
    }

    return results;
  }

  /**
   * Broadcast notification count update to an agent
   */
  async sendUnreadCountUpdate(agentId: string, count: number): Promise<void> {
    try {
      const room = `agent:${agentId}`;

      this.io.to(room).emit('notification', {
        type: 'unread_count',
        data: { count },
        timestamp: new Date().toISOString(),
      });

      logger.debug(`Unread count update sent to agent ${agentId}: ${count}`);
    } catch (error) {
      logger.error(`Error sending unread count to agent ${agentId}:`, error);
    }
  }

  /**
   * Check if an agent is currently connected
   */
  isAgentConnected(agentId: string): boolean {
    return this.connectedAgents.has(agentId) && this.connectedAgents.get(agentId)!.size > 0;
  }

  /**
   * Get number of connected agents
   */
  getConnectedAgentsCount(): number {
    return this.connectedAgents.size;
  }

  /**
   * Get Server instance for external use
   */
  getServer(): Server {
    return this.io;
  }

  /**
   * Close all connections and cleanup
   */
  async close(): Promise<void> {
    logger.info('Closing WebSocket service...');

    // Disconnect all clients
    const sockets = await this.io.fetchSockets();
    for (const socket of sockets) {
      socket.disconnect(true);
    }

    // Close the server
    this.io.close();
    this.connectedAgents.clear();

    logger.info('WebSocket service closed');
  }
}
