import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

export interface UploadedFile {
  filename: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  storageType: 'local' | 's3' | 'minio';
  url: string;
}

export class StorageService {
  private s3Client?: S3Client;

  constructor() {
    // Initialize S3 client if using S3 or MinIO
    if (env.STORAGE_TYPE === 's3' || env.STORAGE_TYPE === 'minio') {
      if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY || !env.S3_BUCKET) {
        throw new Error('S3 credentials not configured');
      }

      this.s3Client = new S3Client({
        region: env.S3_REGION,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        },
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      });
    }
  }

  /**
   * Upload a file to the configured storage backend
   */
  async uploadFile(
    fileBuffer: Buffer,
    originalFilename: string,
    mimeType: string,
  ): Promise<UploadedFile> {
    const filename = this.generateFilename(originalFilename);
    const sizeBytes = fileBuffer.length;

    if (env.STORAGE_TYPE === 'local') {
      return this.uploadLocal(fileBuffer, filename, originalFilename, mimeType, sizeBytes);
    } else if (env.STORAGE_TYPE === 's3' || env.STORAGE_TYPE === 'minio') {
      return this.uploadS3(fileBuffer, filename, originalFilename, mimeType, sizeBytes);
    }

    throw new Error(`Unsupported storage type: ${env.STORAGE_TYPE}`);
  }

  /**
   * Delete a file from storage
   */
  async deleteFile(storagePath: string, storageType: string): Promise<void> {
    try {
      if (storageType === 'local') {
        const fullPath = path.join(process.cwd(), storagePath);
        await fs.unlink(fullPath);
        logger.info(`Deleted local file: ${fullPath}`);
      } else if (storageType === 's3' || storageType === 'minio') {
        if (!this.s3Client) {
          throw new Error('S3 client not initialized');
        }

        const command = new DeleteObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: storagePath,
        });

        await this.s3Client.send(command);
        logger.info(`Deleted S3 file: ${storagePath}`);
      }
    } catch (error) {
      logger.error('Failed to delete file', { storagePath, storageType, error });
      throw error;
    }
  }

  /**
   * Get a signed URL for accessing a file (S3 only)
   */
  async getSignedUrl(storagePath: string, expiresIn = 3600): Promise<string> {
    if (env.STORAGE_TYPE === 'local') {
      // For local storage, return the path as-is
      return `/uploads/${storagePath}`;
    }

    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    // For S3, you would typically use @aws-sdk/s3-request-presigner
    // For simplicity, we'll return the public URL
    const baseUrl = env.S3_ENDPOINT || `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com`;
    return `${baseUrl}/${storagePath}`;
  }

  /**
   * Upload file to local filesystem
   */
  private async uploadLocal(
    fileBuffer: Buffer,
    filename: string,
    originalFilename: string,
    mimeType: string,
    sizeBytes: number,
  ): Promise<UploadedFile> {
    const uploadDir = env.STORAGE_LOCAL_PATH;
    const fullPath = path.join(process.cwd(), uploadDir);

    // Ensure upload directory exists
    await fs.mkdir(fullPath, { recursive: true });

    // Save file
    const filePath = path.join(fullPath, filename);
    await fs.writeFile(filePath, fileBuffer);

    logger.info(`File uploaded locally: ${filePath}`);

    return {
      filename,
      originalFilename,
      mimeType,
      sizeBytes,
      storagePath: path.join(uploadDir, filename),
      storageType: 'local',
      url: `/uploads/${filename}`,
    };
  }

  /**
   * Upload file to S3 or MinIO
   */
  private async uploadS3(
    fileBuffer: Buffer,
    filename: string,
    originalFilename: string,
    mimeType: string,
    sizeBytes: number,
  ): Promise<UploadedFile> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const key = `media/${filename}`;

    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
      Metadata: {
        originalFilename,
      },
    });

    await this.s3Client.send(command);
    logger.info(`File uploaded to S3: ${key}`);

    const url = await this.getSignedUrl(key);

    return {
      filename,
      originalFilename,
      mimeType,
      sizeBytes,
      storagePath: key,
      storageType: env.STORAGE_TYPE as 's3' | 'minio',
      url,
    };
  }

  /**
   * Generate a unique filename with timestamp and UUID
   */
  private generateFilename(originalFilename: string): string {
    const ext = path.extname(originalFilename);
    const timestamp = Date.now();
    const uniqueId = randomUUID().split('-')[0];
    return `${timestamp}-${uniqueId}${ext}`;
  }
}
