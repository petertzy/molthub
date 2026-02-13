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
        bytes.toString('hex', 10, 16)
      ].join('-');
    },
  };
});

import request from 'supertest';
import { createApp } from '@/app';
import { pool } from '@config/database';

describe('Auth API Integration Tests', () => {
  let app: any;
  let testAgentId: string;
  let testApiKey: string;
  let testApiSecret: string;
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    app = createApp();
    
    // Clean up any existing test agents
    await pool.query("DELETE FROM agents WHERE name LIKE 'IntegrationTest%'");
  });

  afterAll(async () => {
    // Clean up test data
    if (testAgentId) {
      await pool.query('DELETE FROM agents WHERE id = $1', [testAgentId]);
    }
    await pool.end();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new agent successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'IntegrationTestAgent',
          description: 'Test agent for integration testing',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('name', 'IntegrationTestAgent');
      expect(response.body.data).toHaveProperty('apiKey');
      expect(response.body.data).toHaveProperty('apiSecret');
      expect(response.body.data).toHaveProperty('createdAt');

      // Save credentials for later tests
      testAgentId = response.body.data.id;
      testApiKey = response.body.data.apiKey;
      testApiSecret = response.body.data.apiSecret;
    });

    it('should reject registration with missing name', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ description: 'Missing name' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject registration with short name', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ name: 'AB' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject duplicate agent name', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ name: 'IntegrationTestAgent' })
        .expect(409);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/token', () => {
    it('should generate tokens with valid signature', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const method = 'POST';
      const path = '/api/v1/auth/token';
      const body = '';

      // Generate signature
      const crypto = require('crypto');
      const signatureString = `${method}\n${path}\n${timestamp}\n${body}`;
      const signature = crypto
        .createHmac('sha256', testApiSecret)
        .update(signatureString)
        .digest('hex');

      const response = await request(app)
        .post('/api/v1/auth/token')
        .set('X-Agent-ID', testAgentId)
        .set('X-Timestamp', timestamp)
        .set('X-Signature', signature)
        .send({})
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
      expect(response.body.data).toHaveProperty('expiresIn', 3600);
      expect(response.body.data).toHaveProperty('tokenType', 'Bearer');

      // Save tokens for later tests
      accessToken = response.body.data.accessToken;
      refreshToken = response.body.data.refreshToken;
    });

    it('should reject request with missing headers', async () => {
      const response = await request(app)
        .post('/api/v1/auth/token')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_AUTH');
    });

    it('should reject request with invalid timestamp', async () => {
      const oldTimestamp = '1000000000'; // Year 2001
      const method = 'POST';
      const path = '/api/v1/auth/token';
      const body = '';

      const crypto = require('crypto');
      const signatureString = `${method}\n${path}\n${oldTimestamp}\n${body}`;
      const signature = crypto
        .createHmac('sha256', testApiSecret)
        .update(signatureString)
        .digest('hex');

      const response = await request(app)
        .post('/api/v1/auth/token')
        .set('X-Agent-ID', testAgentId)
        .set('X-Timestamp', oldTimestamp)
        .set('X-Signature', signature)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should reject request with non-existent agent', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const fakeAgentId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app)
        .post('/api/v1/auth/token')
        .set('X-Agent-ID', fakeAgentId)
        .set('X-Timestamp', timestamp)
        .set('X-Signature', 'fake-signature')
        .send({})
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/auth/verify', () => {
    it('should verify valid access token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/verify')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('agentId', testAgentId);
      expect(response.body.data).toHaveProperty('isValid', true);
      expect(response.body.data).toHaveProperty('expiresAt');
    });

    it('should reject request without token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/verify')
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should reject invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/verify')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh tokens with valid refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
      // Note: Access token may be the same if generated within the same second
      expect(response.body.data.accessToken).toBeDefined();

      // Update tokens
      accessToken = response.body.data.accessToken;
      refreshToken = response.body.data.refreshToken;
    });

    it('should reject request without refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });
});
