import { Request, Response, NextFunction } from 'express';
import { AuditService } from './audit.service';
import { AuditAction, AuditStatus, ResourceType } from './audit.types';
import { logger } from '@config/logger';

/**
 * Middleware to automatically log audit events for requests
 */
export class AuditMiddleware {
  private auditService: AuditService;

  constructor(auditService: AuditService) {
    this.auditService = auditService;
  }

  /**
   * Extract action from request method and path
   */
  private extractAction(method: string, path: string): AuditAction | null {
    // Authentication routes
    if (path.includes('/auth/login')) return AuditAction.AUTH_LOGIN;
    if (path.includes('/auth/register')) return AuditAction.AUTH_REGISTER;
    if (path.includes('/auth/refresh')) return AuditAction.AUTH_TOKEN_REFRESH;
    if (path.includes('/auth/logout')) return AuditAction.AUTH_LOGOUT;

    // Forum routes
    if (path.includes('/forums')) {
      if (method === 'POST') return AuditAction.FORUM_CREATE;
      if (method === 'PUT' || method === 'PATCH') return AuditAction.FORUM_UPDATE;
      if (method === 'DELETE') return AuditAction.FORUM_DELETE;
    }

    // Post routes
    if (path.includes('/posts')) {
      if (method === 'POST') return AuditAction.POST_CREATE;
      if (method === 'PUT' || method === 'PATCH') return AuditAction.POST_UPDATE;
      if (method === 'DELETE') return AuditAction.POST_DELETE;
      if (method === 'GET' && path.match(/\/posts\/[a-f0-9-]+$/))
        return AuditAction.POST_VIEW;
    }

    // Comment routes
    if (path.includes('/comments')) {
      if (method === 'POST') return AuditAction.COMMENT_CREATE;
      if (method === 'PUT' || method === 'PATCH') return AuditAction.COMMENT_UPDATE;
      if (method === 'DELETE') return AuditAction.COMMENT_DELETE;
    }

    // Vote routes
    if (path.includes('/vote')) {
      if (method === 'POST') return AuditAction.VOTE_CREATE;
      if (method === 'PUT' || method === 'PATCH') return AuditAction.VOTE_UPDATE;
      if (method === 'DELETE') return AuditAction.VOTE_DELETE;
    }

    // Media routes
    if (path.includes('/media')) {
      if (method === 'POST') return AuditAction.MEDIA_UPLOAD;
      if (method === 'DELETE') return AuditAction.MEDIA_DELETE;
    }

    // Search routes
    if (path.includes('/search')) {
      return AuditAction.SEARCH_QUERY;
    }

    // Agent routes
    if (path.includes('/agents')) {
      if (method === 'POST') return AuditAction.AGENT_CREATE;
      if (method === 'PUT' || method === 'PATCH') return AuditAction.AGENT_UPDATE;
      if (method === 'DELETE') return AuditAction.AGENT_DELETE;
    }

    return null;
  }

  /**
   * Extract resource type and ID from path
   */
  private extractResource(
    path: string,
  ): { type: ResourceType | null; id: string | null } {
    // Extract UUID from path
    const uuidMatch = path.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
    const id = uuidMatch ? uuidMatch[0] : null;

    // Determine resource type
    if (path.includes('/forums')) return { type: ResourceType.FORUM, id };
    if (path.includes('/posts')) return { type: ResourceType.POST, id };
    if (path.includes('/comments')) return { type: ResourceType.COMMENT, id };
    if (path.includes('/vote')) return { type: ResourceType.VOTE, id };
    if (path.includes('/media')) return { type: ResourceType.MEDIA, id };
    if (path.includes('/agents')) return { type: ResourceType.AGENT, id };
    if (path.includes('/auth')) return { type: ResourceType.AUTH, id };
    if (path.includes('/search')) return { type: ResourceType.SEARCH, id };

    return { type: null, id };
  }

  /**
   * Main middleware function
   */
  public middleware() {
    // Capture references to avoid context issues
    const auditService = this.auditService;
    const extractAction = this.extractAction.bind(this);
    const extractResource = this.extractResource.bind(this);

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      // Store the original send function
      const originalSend = res.send;

      // Override send to log after response
      res.send = function (body: any): Response {
        // Restore original send
        res.send = originalSend;

        // Log the audit event asynchronously (don't block response)
        setImmediate(async () => {
          try {
            const action = extractAction(req.method, req.path);

            // Only log if we can determine the action
            if (action) {
              const resource = extractResource(req.path);
              const status =
                res.statusCode >= 200 && res.statusCode < 300
                  ? AuditStatus.SUCCESS
                  : res.statusCode >= 400 && res.statusCode < 500
                    ? AuditStatus.WARNING
                    : AuditStatus.FAILURE;

              await auditService.log({
                agent_id: (req as any).agent?.id,
                action,
                resource_type: resource.type || undefined,
                resource_id: resource.id || undefined,
                status,
                ip_address: req.ip || req.socket.remoteAddress,
                user_agent: req.get('user-agent'),
                details: {
                  method: req.method,
                  path: req.path,
                  status_code: res.statusCode,
                  query: req.query,
                  // Don't log request body to avoid sensitive data
                },
              });
            }
          } catch (error) {
            // Silently fail - don't block response
            logger.error('Audit middleware error', { error });
          }
        });

        // Send the response
        return originalSend.call(this, body);
      };

      next();
    };
  }

  /**
   * Manual audit logging for specific events
   */
  public async logEvent(
    agentId: string | undefined,
    action: AuditAction,
    resourceType: ResourceType | undefined,
    resourceId: string | undefined,
    status: AuditStatus,
    details?: Record<string, any>,
    req?: Request,
  ): Promise<void> {
    try {
      await this.auditService.log({
        agent_id: agentId,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        status,
        ip_address: req?.ip || req?.socket.remoteAddress,
        user_agent: req?.get('user-agent'),
        details,
      });
    } catch (error) {
      logger.error('Failed to log audit event', { error, action, agentId });
    }
  }

  /**
   * Log security events
   */
  public async logSecurityEvent(
    action: AuditAction,
    req: Request,
    details?: Record<string, any>,
  ): Promise<void> {
    try {
      await this.auditService.log({
        agent_id: (req as any).agent?.id,
        action,
        status: AuditStatus.WARNING,
        ip_address: req.ip || req.socket.remoteAddress,
        user_agent: req.get('user-agent'),
        details,
      });
    } catch (error) {
      logger.error('Failed to log security event', { error, action });
    }
  }
}

/**
 * Factory function to create audit middleware
 */
export function createAuditMiddleware(auditService: AuditService): AuditMiddleware {
  return new AuditMiddleware(auditService);
}
