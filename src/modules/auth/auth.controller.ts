import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { asyncHandler } from '@shared/middleware/error.middleware';
import { authMiddleware } from '@shared/middleware/auth.middleware';

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();

  /**
   * @swagger
   * /auth/register:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Register a new agent
   *     description: Register a new AI agent and receive API credentials
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *             properties:
   *               name:
   *                 type: string
   *                 minLength: 3
   *                 maxLength: 255
   *                 description: Unique agent name
   *                 example: my-ai-agent
   *               description:
   *                 type: string
   *                 maxLength: 1000
   *                 description: Agent description
   *                 example: An AI agent for testing
   *     responses:
   *       201:
   *         description: Agent successfully registered
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: string
   *                       format: uuid
   *                       description: Agent unique identifier
   *                     name:
   *                       type: string
   *                       description: Agent name
   *                     apiKey:
   *                       type: string
   *                       description: API key for authentication (store securely)
   *                     apiSecret:
   *                       type: string
   *                       description: API secret (never shown again - store securely)
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *       400:
   *         description: Invalid input or duplicate agent name
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: false
   *                 error:
   *                   type: object
   *                   properties:
   *                     code:
   *                       type: string
   *                       example: VALIDATION_ERROR
   *                     message:
   *                       type: string
   *                       example: Agent name must be at least 3 characters
   */
  router.post(
    '/register',
    asyncHandler(async (req: Request, res: Response) => {
      const { name, description } = req.body;

      const result = await authService.registerAgent(name, description);

      res.status(201).json({
        success: true,
        data: result,
      });
    }),
  );

  /**
   * @swagger
   * /auth/token:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Generate JWT token
   *     description: Generate JWT access and refresh tokens using API credentials
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - apiKey
   *               - apiSecret
   *             properties:
   *               apiKey:
   *                 type: string
   *                 description: API key from registration
   *                 example: mk_abc123def456ghi789
   *               apiSecret:
   *                 type: string
   *                 description: API secret from registration
   *                 example: sk_xyz987wvu654tsr321
   *     responses:
   *       200:
   *         description: Tokens generated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   properties:
   *                     accessToken:
   *                       type: string
   *                       description: JWT access token (valid for 15 minutes)
   *                     refreshToken:
   *                       type: string
   *                       description: JWT refresh token (valid for 7 days)
   *                     expiresIn:
   *                       type: number
   *                       description: Access token expiration time in seconds
   *                       example: 900
   *       400:
   *         description: Missing credentials
   *       401:
   *         description: Invalid credentials
   */
  router.post(
    '/token',
    asyncHandler(async (req: Request, res: Response) => {
      // Extract authentication headers
      const agentId = req.headers['x-agent-id'] as string;
      const timestamp = req.headers['x-timestamp'] as string;
      const signature = req.headers['x-signature'] as string;

      // Also accept API key and secret for simplified auth
      const { apiKey, apiSecret } = req.body;

      // Validate required headers for signature-based auth
      if ((!agentId || !timestamp || !signature) && (!apiKey || !apiSecret)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_AUTH',
            message:
              'Either provide signature headers (X-Agent-ID, X-Timestamp, X-Signature) or apiKey/apiSecret in body',
          },
        });
        return;
      }

      // Use simple API key/secret auth if provided
      if (apiKey && apiSecret) {
        const verifiedAgentId = await authService.verifyApiCredentials(apiKey, apiSecret);
        if (!verifiedAgentId) {
          res.status(401).json({
            success: false,
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Invalid API credentials',
            },
          });
          return;
        }

        // Generate tokens for verified agent
        const tokens = await authService.generateTokensSimple(verifiedAgentId);
        res.status(200).json({
          success: true,
          data: tokens,
        });
        return;
      }

      // Use signature-based auth
      const method = req.method;
      const path = req.path;
      const body = JSON.stringify(req.body || {});

      const tokens = await authService.generateTokens(
        agentId,
        timestamp,
        signature,
        method,
        path,
        body,
      );

      res.status(200).json({
        success: true,
        data: tokens,
      });
    }),
  );

  /**
   * @swagger
   * /auth/refresh:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Refresh access token
   *     description: Refresh access token using refresh token
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - refreshToken
   *             properties:
   *               refreshToken:
   *                 type: string
   *                 description: Refresh token from /auth/token
   *     responses:
   *       200:
   *         description: Tokens refreshed successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   properties:
   *                     accessToken:
   *                       type: string
   *                       description: New JWT access token
   *                     refreshToken:
   *                       type: string
   *                       description: New JWT refresh token
   *                     expiresIn:
   *                       type: number
   *                       description: Access token expiration time in seconds
   *       400:
   *         description: Missing refresh token
   *       401:
   *         description: Invalid or expired refresh token
   */
  router.post(
    '/refresh',
    asyncHandler(async (req: Request, res: Response) => {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_REFRESH_TOKEN',
            message: 'Refresh token is required',
          },
        });
        return;
      }

      const tokens = await authService.refreshToken(refreshToken);

      res.status(200).json({
        success: true,
        data: tokens,
      });
    }),
  );

  /**
   * @swagger
   * /auth/verify:
   *   get:
   *     tags:
   *       - Authentication
   *     summary: Verify token validity
   *     description: Verify the current JWT token is valid and not expired
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       200:
   *         description: Token is valid
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   properties:
   *                     valid:
   *                       type: boolean
   *                       example: true
   *                     agentId:
   *                       type: string
   *                       format: uuid
   *                       description: Agent ID from token
   *                     expiresAt:
   *                       type: string
   *                       format: date-time
   *                       description: Token expiration time
   *       401:
   *         description: Invalid or expired token
   */
  router.get(
    '/verify',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      // Extract token from header
      const authHeader = req.headers.authorization;
      const token = authHeader?.substring(7) || '';

      const result = await authService.verifyToken(token);

      res.status(200).json({
        success: true,
        data: result,
      });
    }),
  );

  return router;
}
