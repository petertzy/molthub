import {
  validateFileSize,
  validateMimeType,
  validateFilename,
  isImage,
  sanitizeFilename,
  getMimeType,
  ValidationError,
} from '@modules/media/media.utils';

// Mock environment variables
jest.mock('@/config/env', () => ({
  env: {
    MAX_FILE_SIZE: 52428800, // 50MB
    ALLOWED_FILE_TYPES: 'image/jpeg,image/png,image/gif,image/webp,application/pdf',
    THUMBNAIL_WIDTH: 300,
    THUMBNAIL_HEIGHT: 300,
    THUMBNAIL_QUALITY: 80,
  },
}));

describe('Media Utils', () => {
  describe('validateFileSize', () => {
    it('should accept valid file sizes', () => {
      expect(() => validateFileSize(1024)).not.toThrow();
      expect(() => validateFileSize(1024 * 1024)).not.toThrow();
      expect(() => validateFileSize(50 * 1024 * 1024)).not.toThrow(); // 50MB
    });

    it('should reject files exceeding MAX_FILE_SIZE', () => {
      expect(() => validateFileSize(100 * 1024 * 1024)).toThrow(ValidationError);
      expect(() => validateFileSize(100 * 1024 * 1024)).toThrow(/exceeds maximum/);
    });

    it('should reject empty files', () => {
      expect(() => validateFileSize(0)).toThrow(ValidationError);
      expect(() => validateFileSize(0)).toThrow(/empty/);
    });

    it('should reject negative file sizes', () => {
      expect(() => validateFileSize(-1)).toThrow(ValidationError);
    });
  });

  describe('validateMimeType', () => {
    it('should accept allowed MIME types', () => {
      expect(() => validateMimeType('image/jpeg')).not.toThrow();
      expect(() => validateMimeType('image/png')).not.toThrow();
      expect(() => validateMimeType('image/gif')).not.toThrow();
      expect(() => validateMimeType('image/webp')).not.toThrow();
      expect(() => validateMimeType('application/pdf')).not.toThrow();
    });

    it('should reject disallowed MIME types', () => {
      expect(() => validateMimeType('application/x-msdownload')).toThrow(ValidationError);
      expect(() => validateMimeType('application/x-executable')).toThrow(ValidationError);
      expect(() => validateMimeType('text/html')).toThrow(ValidationError);
      expect(() => validateMimeType('video/mp4')).toThrow(/not allowed/);
    });
  });

  describe('validateFilename', () => {
    it('should accept valid filenames', () => {
      expect(() => validateFilename('document.pdf')).not.toThrow();
      expect(() => validateFilename('image-001.png')).not.toThrow();
      expect(() => validateFilename('file_name.jpeg')).not.toThrow();
    });

    it('should reject empty filenames', () => {
      expect(() => validateFilename('')).toThrow(ValidationError);
      expect(() => validateFilename('')).toThrow(/cannot be empty/);
    });

    it('should reject filenames that are too long', () => {
      const longFilename = 'a'.repeat(256) + '.txt';
      expect(() => validateFilename(longFilename)).toThrow(ValidationError);
      expect(() => validateFilename(longFilename)).toThrow(/too long/);
    });

    it('should reject path traversal attempts', () => {
      expect(() => validateFilename('../etc/passwd')).toThrow(ValidationError);
      expect(() => validateFilename('..\\windows\\system32')).toThrow(ValidationError);
      expect(() => validateFilename('dir/file.txt')).toThrow(ValidationError);
      expect(() => validateFilename('dir\\file.txt')).toThrow(/Invalid filename/);
    });
  });

  describe('isImage', () => {
    it('should identify image MIME types', () => {
      expect(isImage('image/jpeg')).toBe(true);
      expect(isImage('image/png')).toBe(true);
      expect(isImage('image/gif')).toBe(true);
      expect(isImage('image/webp')).toBe(true);
      expect(isImage('image/svg+xml')).toBe(true);
    });

    it('should reject non-image MIME types', () => {
      expect(isImage('application/pdf')).toBe(false);
      expect(isImage('text/plain')).toBe(false);
      expect(isImage('video/mp4')).toBe(false);
      expect(isImage('audio/mpeg')).toBe(false);
    });
  });

  describe('sanitizeFilename', () => {
    it('should keep valid characters', () => {
      expect(sanitizeFilename('file-name_123.txt')).toBe('file-name_123.txt');
      expect(sanitizeFilename('document.PDF')).toBe('document.PDF');
    });

    it('should replace invalid characters with underscores', () => {
      expect(sanitizeFilename('file name.txt')).toBe('file_name.txt');
      expect(sanitizeFilename('file@#$%.txt')).toBe('file____.txt');
      // Note: Some special characters might be filtered by the regex
      expect(sanitizeFilename('file<>:|"?*.txt')).toMatch(/file_+\.txt/);
    });

    it('should handle unicode characters', () => {
      expect(sanitizeFilename('文件.txt')).toBe('__.txt');
      expect(sanitizeFilename('файл.txt')).toBe('____.txt');
    });
  });

  describe('getMimeType', () => {
    it('should detect MIME types from filename extensions', () => {
      expect(getMimeType('image.jpg')).toBe('image/jpeg');
      expect(getMimeType('image.jpeg')).toBe('image/jpeg');
      expect(getMimeType('image.png')).toBe('image/png');
      expect(getMimeType('image.gif')).toBe('image/gif');
      expect(getMimeType('document.pdf')).toBe('application/pdf');
    });

    it('should handle uppercase extensions', () => {
      expect(getMimeType('IMAGE.JPG')).toBe('image/jpeg');
      expect(getMimeType('DOCUMENT.PDF')).toBe('application/pdf');
    });

    it('should throw for unknown extensions', () => {
      expect(() => getMimeType('file.unknown')).toThrow(ValidationError);
      expect(() => getMimeType('file')).toThrow(/Could not determine file type/);
    });
  });
});
