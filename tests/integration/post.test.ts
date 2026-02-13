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

describe('Post API Integration Tests', () => {
  let app: any;
  let testAgentId: string;
  let testApiKey: string;
  let testApiSecret: string;
  let accessToken: string;
  let testForumId: string;
  let testPostId: string;
  let anotherAgentId: string;
  let anotherAccessToken: string;

  beforeAll(async () => {
    app = createApp();

    // Clean up any existing test data
    await pool.query("DELETE FROM posts WHERE title LIKE 'PostTest%'");
    await pool.query("DELETE FROM forums WHERE name LIKE 'PostTest%'");
    await pool.query("DELETE FROM agents WHERE name LIKE 'PostTest%'");

    // Register first test agent
    const agentResponse = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'PostTestAgent1',
        description: 'Test agent for post testing',
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
        name: 'PostTestAgent2',
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

    // Create a test forum
    const forumResponse = await request(app)
      .post('/api/v1/forums')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'PostTestForum',
        description: 'Test forum for post testing',
        category: 'general',
      });

    testForumId = forumResponse.body.data.id;
  });

  afterAll(async () => {
    // Clean up test data
    if (testPostId) {
      await pool.query('DELETE FROM posts WHERE id = $1', [testPostId]);
    }
    await pool.query("DELETE FROM posts WHERE title LIKE 'PostTest%'");
    if (testForumId) {
      await pool.query('DELETE FROM forums WHERE id = $1', [testForumId]);
    }
    await pool.query("DELETE FROM forums WHERE name LIKE 'PostTest%'");
    await pool.query('DELETE FROM agents WHERE id = ANY($1)', [[testAgentId, anotherAgentId]]);
    await pool.end();
  });

  describe('POST /api/v1/forums/:id/posts', () => {
    it('should create a new post successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/forums/${testForumId}/posts`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'PostTest: My First Post',
          content: 'This is the content of my first post. It has enough characters to pass validation.',
          tags: ['test', 'first-post'],
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.title).toBe('PostTest: My First Post');
      expect(response.body.data.forumId).toBe(testForumId);
      expect(response.body.data.authorId).toBe(testAgentId);
      expect(response.body.data.tags).toEqual(['test', 'first-post']);

      testPostId = response.body.data.id;
    });

    it('should fail to create post without authentication', async () => {
      const response = await request(app)
        .post(`/api/v1/forums/${testForumId}/posts`)
        .send({
          title: 'PostTest: Unauthorized Post',
          content: 'This post should not be created.',
        });

      expect(response.status).toBe(401);
    });

    it('should fail to create post with title too short', async () => {
      const response = await request(app)
        .post(`/api/v1/forums/${testForumId}/posts`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Short',
          content: 'This post has a title that is too short.',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('title must be between 10 and 500 characters');
    });

    it('should fail to create post in non-existent forum', async () => {
      const response = await request(app)
        .post('/api/v1/forums/00000000-0000-0000-0000-000000000000/posts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'PostTest: Post in Non-existent Forum',
          content: 'This post should not be created.',
        });

      expect(response.status).toBe(404);
      expect(response.body.error.message).toContain('Forum not found');
    });
  });

  describe('GET /api/v1/posts', () => {
    it('should list posts successfully', async () => {
      const response = await request(app)
        .get('/api/v1/posts')
        .query({ limit: 20, offset: 0, sort: 'newest' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('posts');
      expect(Array.isArray(response.body.data.posts)).toBe(true);
      expect(response.body.data).toHaveProperty('pagination');
    });

    it('should filter posts by forum', async () => {
      const response = await request(app)
        .get('/api/v1/posts')
        .query({ forumId: testForumId });

      expect(response.status).toBe(200);
      expect(response.body.data.posts.every((p: any) => p.forum.id === testForumId)).toBe(true);
    });

    it('should filter posts by tags', async () => {
      const response = await request(app)
        .get('/api/v1/posts')
        .query({ tags: 'test,first-post' });

      expect(response.status).toBe(200);
      expect(response.body.data.posts.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/v1/posts/:id', () => {
    it('should get post details successfully', async () => {
      const response = await request(app)
        .get(`/api/v1/posts/${testPostId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(testPostId);
      expect(response.body.data.title).toBe('PostTest: My First Post');
      expect(response.body.data).toHaveProperty('forum');
      expect(response.body.data).toHaveProperty('author');
      expect(response.body.data).toHaveProperty('stats');
    });

    it('should fail to get non-existent post', async () => {
      const response = await request(app)
        .get('/api/v1/posts/00000000-0000-0000-0000-000000000000');

      expect(response.status).toBe(404);
      expect(response.body.error.message).toContain('Post not found');
    });
  });

  describe('PUT /api/v1/posts/:id', () => {
    it('should update post successfully by author', async () => {
      const response = await request(app)
        .put(`/api/v1/posts/${testPostId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'PostTest: Updated First Post',
          content: 'This is the updated content of my first post.',
          editReason: 'Fixed typos',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe('PostTest: Updated First Post');
      expect(response.body.data.content).toBe('This is the updated content of my first post.');
    });

    it('should fail to update post by non-author', async () => {
      const response = await request(app)
        .put(`/api/v1/posts/${testPostId}`)
        .set('Authorization', `Bearer ${anotherAccessToken}`)
        .send({
          title: 'PostTest: Unauthorized Update',
          content: 'This should not work.',
        });

      expect(response.status).toBe(403);
      expect(response.body.error.message).toContain('Only the post author can edit the post');
    });

    it('should fail to update post without authentication', async () => {
      const response = await request(app)
        .put(`/api/v1/posts/${testPostId}`)
        .send({
          title: 'PostTest: Unauthorized Update',
          content: 'This should not work.',
        });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/posts/:id/history', () => {
    it('should get edit history for post', async () => {
      const response = await request(app)
        .get(`/api/v1/posts/${testPostId}/history`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0]).toHaveProperty('previousTitle');
      expect(response.body.data[0]).toHaveProperty('previousContent');
      expect(response.body.data[0]).toHaveProperty('editReason');
      expect(response.body.data[0].editReason).toBe('Fixed typos');
    });
  });

  describe('DELETE /api/v1/posts/:id', () => {
    it('should fail to delete post by non-author', async () => {
      const response = await request(app)
        .delete(`/api/v1/posts/${testPostId}`)
        .set('Authorization', `Bearer ${anotherAccessToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error.message).toContain('Only the post author can delete the post');
    });

    it('should delete post successfully by author', async () => {
      const response = await request(app)
        .delete(`/api/v1/posts/${testPostId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toBe('Post deleted successfully');
    });

    it('should fail to get deleted post', async () => {
      const response = await request(app)
        .get(`/api/v1/posts/${testPostId}`);

      expect(response.status).toBe(404);
      expect(response.body.error.message).toContain('Post not found');
    });
  });
});
