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

describe('Forum API Integration Tests', () => {
  let app: any;
  let testAgentId: string;
  let testApiKey: string;
  let testApiSecret: string;
  let accessToken: string;
  let testForumId: string;
  let anotherAgentId: string;
  let anotherAccessToken: string;

  beforeAll(async () => {
    app = createApp();

    // Clean up any existing test data
    await pool.query("DELETE FROM forums WHERE name LIKE 'ForumTest%'");
    await pool.query("DELETE FROM agents WHERE name LIKE 'ForumTest%'");

    // Register first test agent
    const agentResponse = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'ForumTestAgent1',
        description: 'Test agent for forum testing',
      });

    testAgentId = agentResponse.body.data.id;
    testApiKey = agentResponse.body.data.apiKey;
    testApiSecret = agentResponse.body.data.apiSecret;

    // Get access token for first agent
    const tokenResponse = await request(app)
      .post('/api/v1/auth/token')
      .send({
        apiKey: testApiKey,
        apiSecret: testApiSecret,
      });

    accessToken = tokenResponse.body.data.accessToken;

    // Register second test agent for permission testing
    const agent2Response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'ForumTestAgent2',
        description: 'Second test agent for permission testing',
      });

    anotherAgentId = agent2Response.body.data.id;

    // Get access token for second agent
    const token2Response = await request(app)
      .post('/api/v1/auth/token')
      .send({
        apiKey: agent2Response.body.data.apiKey,
        apiSecret: agent2Response.body.data.apiSecret,
      });

    anotherAccessToken = token2Response.body.data.accessToken;
  });

  afterAll(async () => {
    // Clean up test data
    if (testForumId) {
      await pool.query('DELETE FROM forums WHERE id = $1', [testForumId]);
    }
    await pool.query("DELETE FROM forums WHERE name LIKE 'ForumTest%'");
    await pool.query('DELETE FROM agents WHERE id = ANY($1)', [[testAgentId, anotherAgentId]]);
    await pool.end();
  });

  describe('POST /api/v1/forums', () => {
    it('should create a new forum successfully', async () => {
      const response = await request(app)
        .post('/api/v1/forums')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'ForumTestAI',
          description: 'A test forum for AI discussions',
          category: 'ai-research',
          rules: {
            maxPostLength: 50000,
            requireTitle: true,
          },
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('name', 'ForumTestAI');
      expect(response.body.data).toHaveProperty('slug', 'forumtestai');
      expect(response.body.data).toHaveProperty('description');
      expect(response.body.data).toHaveProperty('category', 'ai-research');
      expect(response.body.data).toHaveProperty('creatorId', testAgentId);

      testForumId = response.body.data.id;
    });

    it('should reject forum creation without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/forums')
        .send({
          name: 'ForumTestUnauth',
          description: 'Test forum',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should reject forum creation with short name', async () => {
      const response = await request(app)
        .post('/api/v1/forums')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'AB',
          description: 'Too short name',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject forum creation with duplicate name', async () => {
      const response = await request(app)
        .post('/api/v1/forums')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'ForumTestAI',
          description: 'Duplicate name',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject forum creation with long description', async () => {
      const longDescription = 'a'.repeat(1001);
      const response = await request(app)
        .post('/api/v1/forums')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'ForumTestLongDesc',
          description: longDescription,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/forums', () => {
    beforeAll(async () => {
      // Create a few more forums for list testing
      await request(app)
        .post('/api/v1/forums')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'ForumTestPhilosophy',
          description: 'Philosophy discussions',
          category: 'philosophy',
        });

      await request(app)
        .post('/api/v1/forums')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'ForumTestCrypto',
          description: 'Cryptocurrency discussions',
          category: 'crypto',
        });
    });

    it('should list all forums', async () => {
      const response = await request(app)
        .get('/api/v1/forums')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('forums');
      expect(response.body.data).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data.forums)).toBe(true);
      expect(response.body.data.forums.length).toBeGreaterThan(0);
      expect(response.body.data.pagination).toHaveProperty('total');
      expect(response.body.data.pagination).toHaveProperty('limit');
      expect(response.body.data.pagination).toHaveProperty('offset');
      expect(response.body.data.pagination).toHaveProperty('hasMore');
    });

    it('should filter forums by category', async () => {
      const response = await request(app)
        .get('/api/v1/forums?category=philosophy')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.forums.length).toBeGreaterThan(0);
      response.body.data.forums.forEach((forum: any) => {
        expect(forum.category).toBe('philosophy');
      });
    });

    it('should search forums by name', async () => {
      const response = await request(app)
        .get('/api/v1/forums?search=Philosophy')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.forums.length).toBeGreaterThan(0);
      const hasMatch = response.body.data.forums.some(
        (forum: any) => forum.name.toLowerCase().includes('philosophy')
      );
      expect(hasMatch).toBe(true);
    });

    it('should sort forums by newest', async () => {
      const response = await request(app)
        .get('/api/v1/forums?sort=newest')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.forums.length).toBeGreaterThan(0);
      
      // Check that forums are sorted by created_at DESC
      const dates = response.body.data.forums.map((f: any) => new Date(f.createdAt).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
      }
    });

    it('should paginate forum list', async () => {
      const response = await request(app)
        .get('/api/v1/forums?limit=1&offset=0')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.forums.length).toBe(1);
      expect(response.body.data.pagination.limit).toBe(1);
      expect(response.body.data.pagination.offset).toBe(0);
    });

    it('should reject invalid limit', async () => {
      const response = await request(app)
        .get('/api/v1/forums?limit=200')
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject negative offset', async () => {
      const response = await request(app)
        .get('/api/v1/forums?offset=-1')
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/forums/:id', () => {
    it('should get forum details', async () => {
      const response = await request(app)
        .get(`/api/v1/forums/${testForumId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', testForumId);
      expect(response.body.data).toHaveProperty('name');
      expect(response.body.data).toHaveProperty('slug');
      expect(response.body.data).toHaveProperty('description');
      expect(response.body.data).toHaveProperty('category');
      expect(response.body.data).toHaveProperty('creator');
      expect(response.body.data).toHaveProperty('rules');
      expect(response.body.data).toHaveProperty('stats');
      expect(response.body.data.creator).toHaveProperty('id');
      expect(response.body.data.creator).toHaveProperty('name');
    });

    it('should return 404 for non-existent forum', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/api/v1/forums/${nonExistentId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/v1/forums/:id', () => {
    it('should update forum by creator', async () => {
      const response = await request(app)
        .put(`/api/v1/forums/${testForumId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          description: 'Updated description for AI discussions',
          rules: {
            maxPostLength: 60000,
            requireTitle: true,
            allowAttachments: true,
          },
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', testForumId);
      expect(response.body.data).toHaveProperty('description', 'Updated description for AI discussions');
      expect(response.body.data.rules).toHaveProperty('maxPostLength', 60000);
    });

    it('should reject update without authentication', async () => {
      const response = await request(app)
        .put(`/api/v1/forums/${testForumId}`)
        .send({
          description: 'Unauthorized update',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should reject update by non-creator', async () => {
      const response = await request(app)
        .put(`/api/v1/forums/${testForumId}`)
        .set('Authorization', `Bearer ${anotherAccessToken}`)
        .send({
          description: 'Unauthorized update by different agent',
        })
        .expect(403);

      expect(response.body.success).toBe(false);
    });

    it('should reject update with long description', async () => {
      const longDescription = 'a'.repeat(1001);
      const response = await request(app)
        .put(`/api/v1/forums/${testForumId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          description: longDescription,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 for non-existent forum', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .put(`/api/v1/forums/${nonExistentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          description: 'Update non-existent',
        })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/forums/:id/posts', () => {
    beforeAll(async () => {
      // Create some test posts
      await pool.query(
        `INSERT INTO posts (forum_id, author_id, title, content, vote_count, comment_count)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [testForumId, testAgentId, 'Test Post 1', 'Content of test post 1', 10, 5]
      );
      await pool.query(
        `INSERT INTO posts (forum_id, author_id, title, content, vote_count, comment_count, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [testForumId, testAgentId, 'Test Post 2', 'Content of test post 2', 20, 3, ['ai', 'machine-learning']]
      );
    });

    it('should get forum posts', async () => {
      const response = await request(app)
        .get(`/api/v1/forums/${testForumId}/posts`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('posts');
      expect(response.body.data).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data.posts)).toBe(true);
      expect(response.body.data.posts.length).toBeGreaterThan(0);
      
      const post = response.body.data.posts[0];
      expect(post).toHaveProperty('id');
      expect(post).toHaveProperty('title');
      expect(post).toHaveProperty('content');
      expect(post).toHaveProperty('author');
      expect(post).toHaveProperty('stats');
    });

    it('should sort posts by newest', async () => {
      const response = await request(app)
        .get(`/api/v1/forums/${testForumId}/posts?sort=newest`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.posts.length).toBeGreaterThan(0);
    });

    it('should filter posts by tags', async () => {
      const response = await request(app)
        .get(`/api/v1/forums/${testForumId}/posts?tags=ai,machine-learning`)
        .expect(200);

      expect(response.body.success).toBe(true);
      // Should return posts with those tags
    });

    it('should paginate posts', async () => {
      const response = await request(app)
        .get(`/api/v1/forums/${testForumId}/posts?limit=1&offset=0`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.posts.length).toBeLessThanOrEqual(1);
      expect(response.body.data.pagination.limit).toBe(1);
    });

    it('should return 404 for non-existent forum', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/api/v1/forums/${nonExistentId}/posts`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/v1/forums/:id', () => {
    let forumToDelete: string;

    beforeAll(async () => {
      // Create a forum to delete
      const response = await request(app)
        .post('/api/v1/forums')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'ForumTestToDelete',
          description: 'This forum will be deleted',
        });

      forumToDelete = response.body.data.id;
    });

    it('should reject deletion without authentication', async () => {
      const response = await request(app)
        .delete(`/api/v1/forums/${forumToDelete}`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should reject deletion by non-creator', async () => {
      const response = await request(app)
        .delete(`/api/v1/forums/${forumToDelete}`)
        .set('Authorization', `Bearer ${anotherAccessToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
    });

    it('should delete forum by creator', async () => {
      const response = await request(app)
        .delete(`/api/v1/forums/${forumToDelete}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('message');

      // Verify forum is deleted
      const getResponse = await request(app)
        .get(`/api/v1/forums/${forumToDelete}`)
        .expect(404);

      expect(getResponse.body.success).toBe(false);
    });

    it('should return 404 when deleting non-existent forum', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .delete(`/api/v1/forums/${nonExistentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });
});
