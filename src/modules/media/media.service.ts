import { Pool } from 'pg';
import { StorageService, UploadedFile } from './media.storage';
import {
  validateFileSize,
  validateMimeType,
  validateFilename,
  isImage,
  generateThumbnail,
  getImageDimensions,
  ValidationError,
} from './media.utils';
import { ForbiddenError } from '@/shared/middleware/error.middleware';
import { logger } from '@/config/logger';
import { env } from '@/config/env';

export interface MediaFile {
  id: string;
  uploaderId: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  storageType: string;
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UploadOptions {
  generateThumbnails?: boolean;
}

export class MediaService {
  constructor(
    private pool: Pool,
    private storageService: StorageService,
  ) {}

  /**
   * Upload a file
   */
  async uploadFile(
    agentId: string,
    fileBuffer: Buffer,
    originalFilename: string,
    mimeType: string,
    options: UploadOptions = {},
  ): Promise<MediaFile> {
    // Validate file
    validateFilename(originalFilename);
    validateFileSize(fileBuffer.length);
    validateMimeType(mimeType);

    // Upload file to storage
    const uploadedFile = await this.storageService.uploadFile(
      fileBuffer,
      originalFilename,
      mimeType,
    );

    let thumbnailUrl: string | undefined;
    let width: number | undefined;
    let height: number | undefined;

    // Generate thumbnail if it's an image and option is enabled
    if (isImage(mimeType) && options.generateThumbnails !== false) {
      try {
        // Get image dimensions
        const dimensions = await getImageDimensions(fileBuffer);
        width = dimensions.width;
        height = dimensions.height;

        // Generate thumbnail
        const thumbnailBuffer = await generateThumbnail(fileBuffer);
        const thumbnailFilename = `thumb_${uploadedFile.filename}`;

        const thumbnailFile = await this.storageService.uploadFile(
          thumbnailBuffer,
          thumbnailFilename,
          'image/jpeg',
        );

        thumbnailUrl = thumbnailFile.url;
      } catch (error) {
        logger.warn('Failed to generate thumbnail', { error, filename: originalFilename });
        // Continue without thumbnail
      }
    }

    // Save metadata to database
    const query = `
      INSERT INTO media_files (
        uploader_id, filename, original_filename, mime_type, size_bytes,
        storage_path, storage_type, url, thumbnail_url, width, height, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, uploader_id, filename, original_filename, mime_type, size_bytes,
                storage_path, storage_type, url, thumbnail_url, width, height,
                metadata, created_at, updated_at
    `;

    const result = await this.pool.query(query, [
      agentId,
      uploadedFile.filename,
      uploadedFile.originalFilename,
      uploadedFile.mimeType,
      uploadedFile.sizeBytes,
      uploadedFile.storagePath,
      uploadedFile.storageType,
      uploadedFile.url,
      thumbnailUrl,
      width,
      height,
      JSON.stringify({}),
    ]);

    logger.info('File uploaded successfully', {
      fileId: result.rows[0].id,
      agentId,
      filename: uploadedFile.filename,
    });

    return this.mapRowToMediaFile(result.rows[0]);
  }

  /**
   * Get file metadata by ID
   */
  async getFileById(fileId: string): Promise<MediaFile | null> {
    const query = `
      SELECT id, uploader_id, filename, original_filename, mime_type, size_bytes,
             storage_path, storage_type, url, thumbnail_url, width, height,
             metadata, created_at, updated_at
      FROM media_files
      WHERE id = $1 AND deleted_at IS NULL
    `;

    const result = await this.pool.query(query, [fileId]);

    if (result.rowCount === 0) {
      return null;
    }

    return this.mapRowToMediaFile(result.rows[0]);
  }

  /**
   * Get files uploaded by an agent
   */
  async getFilesByAgent(
    agentId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ files: MediaFile[]; total: number }> {
    const countQuery = `
      SELECT COUNT(*) FROM media_files
      WHERE uploader_id = $1 AND deleted_at IS NULL
    `;

    const filesQuery = `
      SELECT id, uploader_id, filename, original_filename, mime_type, size_bytes,
             storage_path, storage_type, url, thumbnail_url, width, height,
             metadata, created_at, updated_at
      FROM media_files
      WHERE uploader_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const [countResult, filesResult] = await Promise.all([
      this.pool.query(countQuery, [agentId]),
      this.pool.query(filesQuery, [agentId, limit, offset]),
    ]);

    return {
      files: filesResult.rows.map(this.mapRowToMediaFile),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  /**
   * Delete a file (soft delete)
   */
  async deleteFile(fileId: string, agentId: string): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Get file info
      const selectQuery = `
        SELECT uploader_id, storage_path, storage_type, thumbnail_url
        FROM media_files
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE
      `;

      const result = await client.query(selectQuery, [fileId]);

      if (result.rowCount === 0) {
        throw new Error('File not found');
      }

      const file = result.rows[0];

      // Check if agent owns the file
      if (file.uploader_id !== agentId) {
        throw new ForbiddenError('You do not have permission to delete this file');
      }

      // Soft delete in database
      const deleteQuery = `
        UPDATE media_files
        SET deleted_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `;

      await client.query(deleteQuery, [fileId]);

      await client.query('COMMIT');

      // Delete from storage (async, don't wait)
      this.storageService.deleteFile(file.storage_path, file.storage_type).catch((error) => {
        logger.error('Failed to delete file from storage', { fileId, error });
      });

      // Delete thumbnail if exists
      if (file.thumbnail_url) {
        const thumbnailPath = file.thumbnail_url.replace('/uploads/', '');
        this.storageService.deleteFile(thumbnailPath, file.storage_type).catch((error) => {
          logger.error('Failed to delete thumbnail from storage', { fileId, error });
        });
      }

      logger.info('File deleted successfully', { fileId, agentId });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Clean up old deleted files
   */
  async cleanupDeletedFiles(daysOld = 30): Promise<number> {
    const query = `
      SELECT id, storage_path, storage_type, thumbnail_url
      FROM media_files
      WHERE deleted_at IS NOT NULL
        AND deleted_at < NOW() - INTERVAL $1
      LIMIT 100
    `;

    const result = await this.pool.query(query, [`${daysOld} days`]);
    let deletedCount = 0;

    for (const row of result.rows) {
      try {
        // Delete from storage
        await this.storageService.deleteFile(row.storage_path, row.storage_type);

        // Delete thumbnail if exists
        if (row.thumbnail_url) {
          const thumbnailPath = row.thumbnail_url.replace('/uploads/', '');
          await this.storageService.deleteFile(thumbnailPath, row.storage_type);
        }

        // Permanently delete from database
        await this.pool.query('DELETE FROM media_files WHERE id = $1', [row.id]);

        deletedCount++;
      } catch (error) {
        logger.error('Failed to cleanup file', { fileId: row.id, error });
      }
    }

    logger.info(`Cleaned up ${deletedCount} deleted files`);
    return deletedCount;
  }

  /**
   * Map database row to MediaFile object
   */
  private mapRowToMediaFile(row: any): MediaFile {
    return {
      id: row.id,
      uploaderId: row.uploader_id,
      filename: row.filename,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      sizeBytes: parseInt(row.size_bytes, 10),
      storagePath: row.storage_path,
      storageType: row.storage_type,
      url: row.url,
      thumbnailUrl: row.thumbnail_url,
      width: row.width,
      height: row.height,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
