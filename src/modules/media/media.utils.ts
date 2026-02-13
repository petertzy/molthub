import sharp from 'sharp';
import * as mime from 'mime-types';
import { env } from '@/config/env';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Validate file size
 */
export function validateFileSize(sizeBytes: number): void {
  if (sizeBytes > env.MAX_FILE_SIZE) {
    const maxMB = env.MAX_FILE_SIZE / (1024 * 1024);
    throw new ValidationError(`File size exceeds maximum allowed (${maxMB}MB)`);
  }
  if (sizeBytes <= 0) {
    throw new ValidationError('File is empty');
  }
}

/**
 * Validate file MIME type
 */
export function validateMimeType(mimeType: string): void {
  const allowedTypes = env.ALLOWED_FILE_TYPES.split(',').map((t) => t.trim());

  if (!allowedTypes.includes(mimeType)) {
    throw new ValidationError(
      `File type ${mimeType} not allowed. Allowed types: ${allowedTypes.join(', ')}`,
    );
  }
}

/**
 * Validate filename (basic sanitization)
 */
export function validateFilename(filename: string): void {
  if (!filename || filename.length === 0) {
    throw new ValidationError('Filename cannot be empty');
  }

  if (filename.length > 255) {
    throw new ValidationError('Filename too long (max 255 characters)');
  }

  // Check for path traversal attempts
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new ValidationError('Invalid filename');
  }
}

/**
 * Get MIME type from filename
 */
export function getMimeType(filename: string): string {
  const mimeType = mime.lookup(filename);
  if (!mimeType) {
    throw new ValidationError('Could not determine file type');
  }
  return mimeType;
}

/**
 * Check if file is an image
 */
export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Generate thumbnail for an image
 */
export async function generateThumbnail(
  imageBuffer: Buffer,
  width = env.THUMBNAIL_WIDTH,
  height = env.THUMBNAIL_HEIGHT,
  quality = env.THUMBNAIL_QUALITY,
): Promise<Buffer> {
  try {
    return await sharp(imageBuffer)
      .resize(width, height, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality })
      .toBuffer();
  } catch (error) {
    throw new Error(`Failed to generate thumbnail: ${error}`);
  }
}

/**
 * Get image dimensions
 */
export async function getImageDimensions(imageBuffer: Buffer): Promise<ImageDimensions> {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('Could not read image dimensions');
    }
    return {
      width: metadata.width,
      height: metadata.height,
    };
  } catch (error) {
    throw new Error(`Failed to get image dimensions: ${error}`);
  }
}

/**
 * Sanitize filename for storage
 */
export function sanitizeFilename(filename: string): string {
  // Remove any non-alphanumeric characters except dots, dashes, and underscores
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}
