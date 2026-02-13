// Mock uuid to avoid ESM issues with jest
jest.mock('uuid', () => {
  const { randomBytes } = require('crypto');
  return {
    v4: () => {
      const bytes = randomBytes(16);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
      return [
        bytes.toString('hex', 0, 4),
        bytes.toString('hex', 4, 6),
        bytes.toString('hex', 6, 8),
        bytes.toString('hex', 8, 10),
        bytes.toString('hex', 10, 16),
      ].join('-');
    },
  };
});

import request from 'supertest';
import { createApp } from '@/app';
import { pool } from '@config/database';
import * as fs from 'fs';
import * as path from 'path';

describe('Media API Integration Tests', () => {
  let app: any;
  let testAgentId: string;
  let testApiKey: string;
  let testApiSecret: string;
  let accessToken: string;
  let uploadedFileId: string;

  beforeAll(async () => {
    app = createApp();

    // Clean up any existing test data
    await pool.query("DELETE FROM media_files WHERE original_filename LIKE 'test%'");
    await pool.query("DELETE FROM agents WHERE name LIKE 'MediaTest%'");

    // Register test agent
    const agentResponse = await request(app).post('/api/v1/auth/register').send({
      name: 'MediaTestAgent',
      description: 'Test agent for media testing',
    });

    testAgentId = agentResponse.body.data.id;
    testApiKey = agentResponse.body.data.apiKey;
    testApiSecret = agentResponse.body.data.apiSecret;

    // Get access token
    const tokenResponse = await request(app).post('/api/v1/auth/token').send({
      apiKey: testApiKey,
      apiSecret: testApiSecret,
    });

    accessToken = tokenResponse.body.data.accessToken;
  });

  afterAll(async () => {
    // Clean up test data
    if (uploadedFileId) {
      await pool.query('DELETE FROM media_files WHERE id = $1', [uploadedFileId]);
    }
    await pool.query("DELETE FROM media_files WHERE original_filename LIKE 'test%'");
    await pool.query("DELETE FROM agents WHERE name LIKE 'MediaTest%'");
    await pool.end();
  });

  describe('POST /api/v1/media/upload', () => {
    it('should upload a file successfully', async () => {
      // Create a test image buffer (1x1 pixel PNG)
      const testImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      );

      const response = await request(app)
        .post('/api/v1/media/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', testImageBuffer, {
          filename: 'test-image.png',
          contentType: 'image/png',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('filename');
      expect(response.body.data).toHaveProperty('originalFilename', 'test-image.png');
      expect(response.body.data).toHaveProperty('mimeType', 'image/png');
      expect(response.body.data).toHaveProperty('url');

      // Save file ID for cleanup
      uploadedFileId = response.body.data.id;
    });

    it('should fail without authentication', async () => {
      const testImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      );

      const response = await request(app)
        .post('/api/v1/media/upload')
        .attach('file', testImageBuffer, {
          filename: 'test-image.png',
          contentType: 'image/png',
        });

      expect(response.status).toBe(401);
    });

    it('should fail without file', async () => {
      const response = await request(app)
        .post('/api/v1/media/upload')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NO_FILE');
    });

    it('should reject files that are too large', async () => {
      // Create a buffer larger than MAX_FILE_SIZE
      const largeBuffer = Buffer.alloc(100 * 1024 * 1024); // 100MB

      const response = await request(app)
        .post('/api/v1/media/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', largeBuffer, {
          filename: 'large-file.bin',
          contentType: 'application/octet-stream',
        });

      // Multer should reject it before reaching our handler
      expect([400, 413, 500]).toContain(response.status);
    });

    it('should reject unsupported file types', async () => {
      const testBuffer = Buffer.from('test executable content');

      const response = await request(app)
        .post('/api/v1/media/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', testBuffer, {
          filename: 'test.exe',
          contentType: 'application/x-msdownload',
        });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/media/upload-multiple', () => {
    it('should upload multiple files successfully', async () => {
      const testImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      );

      const response = await request(app)
        .post('/api/v1/media/upload-multiple')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('files', testImageBuffer, {
          filename: 'test-image-1.png',
          contentType: 'image/png',
        })
        .attach('files', testImageBuffer, {
          filename: 'test-image-2.png',
          contentType: 'image/png',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(2);
      expect(response.body.data[0]).toHaveProperty('id');
      expect(response.body.data[1]).toHaveProperty('id');

      // Clean up uploaded files
      await pool.query('DELETE FROM media_files WHERE id IN ($1, $2)', [
        response.body.data[0].id,
        response.body.data[1].id,
      ]);
    });
  });

  describe('GET /api/v1/media/:fileId', () => {
    let testFileId: string;

    beforeAll(async () => {
      // Upload a test file
      const testImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      );

      const response = await request(app)
        .post('/api/v1/media/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', testImageBuffer, {
          filename: 'test-get-image.png',
          contentType: 'image/png',
        });

      testFileId = response.body.data.id;
    });

    afterAll(async () => {
      if (testFileId) {
        await pool.query('DELETE FROM media_files WHERE id = $1', [testFileId]);
      }
    });

    it('should get file metadata by ID', async () => {
      const response = await request(app)
        .get(`/api/v1/media/${testFileId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', testFileId);
      expect(response.body.data).toHaveProperty('uploaderId', testAgentId);
      expect(response.body.data).toHaveProperty('originalFilename');
      expect(response.body.data).toHaveProperty('url');
    });

    it('should return 404 for non-existent file', async () => {
      const response = await request(app)
        .get('/api/v1/media/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/media/my-files', () => {
    it('should list files uploaded by current agent', async () => {
      const response = await request(app)
        .get('/api/v1/media/my-files')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('files');
      expect(response.body.data).toHaveProperty('total');
      expect(Array.isArray(response.body.data.files)).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/v1/media/my-files?limit=10&offset=0')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('limit', 10);
      expect(response.body.data).toHaveProperty('offset', 0);
    });
  });

  describe('DELETE /api/v1/media/:fileId', () => {
    it('should delete own file successfully', async () => {
      // Upload a file first
      const testImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      );

      const uploadResponse = await request(app)
        .post('/api/v1/media/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', testImageBuffer, {
          filename: 'test-delete.png',
          contentType: 'image/png',
        });

      const fileId = uploadResponse.body.data.id;

      // Delete the file
      const deleteResponse = await request(app)
        .delete(`/api/v1/media/${fileId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.success).toBe(true);

      // Verify file is soft-deleted
      const result = await pool.query(
        'SELECT deleted_at FROM media_files WHERE id = $1',
        [fileId],
      );
      expect(result.rows[0].deleted_at).not.toBeNull();
    });

    it('should not allow deleting other agent files', async () => {
      // Create another agent and upload a file
      const agent2Response = await request(app).post('/api/v1/auth/register').send({
        name: 'MediaTestAgent2',
        description: 'Second test agent',
      });

      const token2Response = await request(app).post('/api/v1/auth/token').send({
        apiKey: agent2Response.body.data.apiKey,
        apiSecret: agent2Response.body.data.apiSecret,
      });

      const accessToken2 = token2Response.body.data.accessToken;

      const testImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      );

      const uploadResponse = await request(app)
        .post('/api/v1/media/upload')
        .set('Authorization', `Bearer ${accessToken2}`)
        .attach('file', testImageBuffer, {
          filename: 'test-other-agent.png',
          contentType: 'image/png',
        });

      const fileId = uploadResponse.body.data.id;

      // Try to delete with first agent's token
      const deleteResponse = await request(app)
        .delete(`/api/v1/media/${fileId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(deleteResponse.status).toBe(403);
      expect(deleteResponse.body.success).toBe(false);

      // Clean up
      await pool.query('DELETE FROM media_files WHERE id = $1', [fileId]);
      await pool.query('DELETE FROM agents WHERE name = $1', ['MediaTestAgent2']);
    });
  });
});
