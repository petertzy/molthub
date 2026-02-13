import { Router, Request, Response } from 'express';
import multer from 'multer';
import { MediaService } from './media.service';
import { authMiddleware } from '@/shared/middleware/auth.middleware';
import { asyncHandler } from '@/shared/middleware/error.middleware';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_FILE_SIZE,
    files: env.MAX_FILES_PER_UPLOAD,
  },
});

export function createMediaRouter(mediaService: MediaService): Router {
  const router = Router();

  /**
   * Upload a single file
   * POST /api/v1/media/upload
   */
  router.post(
    '/upload',
    authMiddleware,
    upload.single('file'),
    asyncHandler(async (req: Request & { agentId?: string }, res: Response) => {
      if (!req.file) {
        res.status(400).json({
          success: false,
          error: {
            code: 'NO_FILE',
            message: 'No file provided',
          },
        });
        return;
      }

      if (!req.agentId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
        return;
      }

      const { buffer, originalname, mimetype } = req.file;

      const mediaFile = await mediaService.uploadFile(req.agentId, buffer, originalname, mimetype);

      res.status(201).json({
        success: true,
        data: {
          id: mediaFile.id,
          filename: mediaFile.filename,
          originalFilename: mediaFile.originalFilename,
          mimeType: mediaFile.mimeType,
          sizeBytes: mediaFile.sizeBytes,
          url: mediaFile.url,
          thumbnailUrl: mediaFile.thumbnailUrl,
          width: mediaFile.width,
          height: mediaFile.height,
          createdAt: mediaFile.createdAt,
        },
      });

      logger.info('File uploaded via API', {
        fileId: mediaFile.id,
        agentId: req.agentId,
        filename: mediaFile.filename,
      });
    }),
  );

  /**
   * Upload multiple files
   * POST /api/v1/media/upload-multiple
   */
  router.post(
    '/upload-multiple',
    authMiddleware,
    upload.array('files', env.MAX_FILES_PER_UPLOAD),
    asyncHandler(async (req: Request & { agentId?: string }, res: Response) => {
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        res.status(400).json({
          success: false,
          error: {
            code: 'NO_FILES',
            message: 'No files provided',
          },
        });
        return;
      }

      if (!req.agentId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
        return;
      }

      const uploadPromises = req.files.map((file) =>
        mediaService.uploadFile(req.agentId!, file.buffer, file.originalname, file.mimetype),
      );

      const mediaFiles = await Promise.all(uploadPromises);

      res.status(201).json({
        success: true,
        data: mediaFiles.map((mediaFile) => ({
          id: mediaFile.id,
          filename: mediaFile.filename,
          originalFilename: mediaFile.originalFilename,
          mimeType: mediaFile.mimeType,
          sizeBytes: mediaFile.sizeBytes,
          url: mediaFile.url,
          thumbnailUrl: mediaFile.thumbnailUrl,
          width: mediaFile.width,
          height: mediaFile.height,
          createdAt: mediaFile.createdAt,
        })),
      });

      logger.info('Multiple files uploaded via API', {
        count: mediaFiles.length,
        agentId: req.agentId,
      });
    }),
  );

  /**
   * Get files uploaded by current agent
   * GET /api/v1/media/my-files
   * Note: This must be defined before /:fileId to avoid route collision
   */
  router.get(
    '/my-files',
    authMiddleware,
    asyncHandler(async (req: Request & { agentId?: string }, res: Response) => {
      if (!req.agentId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
        return;
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await mediaService.getFilesByAgent(req.agentId, limit, offset);

      res.json({
        success: true,
        data: {
          files: result.files.map((file) => ({
            id: file.id,
            filename: file.filename,
            originalFilename: file.originalFilename,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            url: file.url,
            thumbnailUrl: file.thumbnailUrl,
            width: file.width,
            height: file.height,
            createdAt: file.createdAt,
          })),
          total: result.total,
          limit,
          offset,
        },
      });
    }),
  );

  /**
   * Get file metadata by ID
   * GET /api/v1/media/:fileId
   */
  router.get(
    '/:fileId',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const fileId = req.params.fileId as string;

      const mediaFile = await mediaService.getFileById(fileId);

      if (!mediaFile) {
        res.status(404).json({
          success: false,
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'File not found',
          },
        });
        return;
      }

      res.json({
        success: true,
        data: {
          id: mediaFile.id,
          uploaderId: mediaFile.uploaderId,
          filename: mediaFile.filename,
          originalFilename: mediaFile.originalFilename,
          mimeType: mediaFile.mimeType,
          sizeBytes: mediaFile.sizeBytes,
          url: mediaFile.url,
          thumbnailUrl: mediaFile.thumbnailUrl,
          width: mediaFile.width,
          height: mediaFile.height,
          createdAt: mediaFile.createdAt,
          updatedAt: mediaFile.updatedAt,
        },
      });
    }),
  );

  /**
   * Delete a file
   * DELETE /api/v1/media/:fileId
   */
  router.delete(
    '/:fileId',
    authMiddleware,
    asyncHandler(async (req: Request & { agentId?: string }, res: Response) => {
      if (!req.agentId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
        return;
      }

      const fileId = req.params.fileId as string;

      await mediaService.deleteFile(fileId, req.agentId);

      res.json({
        success: true,
        message: 'File deleted successfully',
      });

      logger.info('File deleted via API', {
        fileId,
        agentId: req.agentId,
      });
    }),
  );

  return router;
}
