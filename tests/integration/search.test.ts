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

describe('Search API Integration Tests', () => {
  let app: any;
  let testAgentId: string;
  let testApiKey: string;
  let testApiSecret: string;
  let accessToken: string;
  let testForumId: string;
  let testPostId: string;
  let testCommentId: string;

  beforeAll(async () => {
    app = createApp();

    // Clean up any existing test data
    await pool.query("DELETE FROM comments WHERE content LIKE 'SearchTest%'");
    await pool.query("DELETE FROM posts WHERE title LIKE 'SearchTest%'");
    await pool.query("DELETE FROM forums WHERE name LIKE 'SearchTest%'");
    await pool.query("DELETE FROM agents WHERE name LIKE 'SearchTest%'");

    // Register test agent
    const agentResponse = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'SearchTestAgent',
        description: 'Test agent for search testing',
      });

    testAgentId = agentResponse.body.data.id;
    testApiKey = agentResponse.body.data.apiKey;
    testApiSecret = agentResponse.body.data.apiSecret;

    // Get access token
    const tokenResponse = await request(app)
      .post('/api/v1/auth/token')
      .send({
        apiKey: testApiKey,
        apiSecret: testApiSecret,
      });

    accessToken = tokenResponse.body.data.accessToken;

    // Create test forum
    const forumResponse = await request(app)
      .post('/api/v1/forums')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'SearchTestForum',
        description: 'Test forum for search testing with quantum computing topics',
        category: 'technology',
      });

    testForumId = forumResponse.body.data.id;

    // Create test posts
    const post1Response = await request(app)
      .post(`/api/v1/forums/${testForumId}/posts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'SearchTest Quantum Computing Basics',
        content: 'This is a post about quantum computing fundamentals and quantum entanglement',
        tags: ['quantum', 'computing'],
      });

    testPostId = post1Response.body.data.id;

    await request(app)
      .post(`/api/v1/forums/${testForumId}/posts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'SearchTest Machine Learning Algorithms',
        content: 'Discussion about machine learning and neural networks',
        tags: ['ml', 'ai'],
      });

    // Create test comment
    const commentResponse = await request(app)
      .post(`/api/v1/posts/${testPostId}/comments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        content: 'SearchTest Great explanation of quantum computing concepts!',
      });

    testCommentId = commentResponse.body.data.id;
  });

  afterAll(async () => {
    // Clean up test data
    if (testCommentId) {
      await pool.query('DELETE FROM comments WHERE id = $1', [testCommentId]);
    }
    if (testPostId) {
      await pool.query('DELETE FROM posts WHERE id = $1', [testPostId]);
    }
    await pool.query("DELETE FROM posts WHERE title LIKE 'SearchTest%'");
    if (testForumId) {
      await pool.query('DELETE FROM forums WHERE id = $1', [testForumId]);
    }
    if (testAgentId) {
      await pool.query('DELETE FROM agents WHERE id = $1', [testAgentId]);
    }

    await pool.end();
  });

  describe('GET /api/v1/search', () => {
    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=quantum');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should require search query parameter', async () => {
      const response = await request(app)
        .get('/api/v1/search')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_QUERY');
    });

    it('should search all content types by default', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=quantum')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('results');
      expect(response.body.data).toHaveProperty('pagination');
    });

    it('should search posts with quantum keyword', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=quantum&type=posts')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.results.posts).toBeDefined();
      
      const posts = response.body.data.results.posts;
      if (posts.length > 0) {
        expect(posts[0]).toHaveProperty('id');
        expect(posts[0]).toHaveProperty('title');
        expect(posts[0]).toHaveProperty('excerpt');
        expect(posts[0]).toHaveProperty('relevanceScore');
        expect(posts[0]).toHaveProperty('forum');
        expect(posts[0]).toHaveProperty('author');
      }
    });

    it('should search comments', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=quantum&type=comments')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.results.comments).toBeDefined();
      
      const comments = response.body.data.results.comments;
      if (comments.length > 0) {
        expect(comments[0]).toHaveProperty('id');
        expect(comments[0]).toHaveProperty('content');
        expect(comments[0]).toHaveProperty('postTitle');
        expect(comments[0]).toHaveProperty('relevanceScore');
      }
    });

    it('should search forums', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=SearchTest&type=forums')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.results.forums).toBeDefined();
    });

    it('should search agents', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=SearchTest&type=agents')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.results.agents).toBeDefined();
      
      const agents = response.body.data.results.agents;
      if (agents.length > 0) {
        expect(agents[0]).toHaveProperty('name');
        expect(agents[0]).toHaveProperty('reputationScore');
      }
    });

    it('should filter by forum', async () => {
      const response = await request(app)
        .get(`/api/v1/search?q=quantum&type=posts&forum=${testForumId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      const posts = response.body.data.results.posts;
      if (posts && posts.length > 0) {
        posts.forEach((post: any) => {
          expect(post.forumId).toBe(testForumId);
        });
      }
    });

    it('should support sorting by relevance', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=quantum&type=posts&sort=relevance')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      const posts = response.body.data.results.posts;
      if (posts && posts.length > 1) {
        // Check that posts are sorted by relevance (descending)
        for (let i = 0; i < posts.length - 1; i++) {
          expect(posts[i].relevanceScore).toBeGreaterThanOrEqual(posts[i + 1].relevanceScore);
        }
      }
    });

    it('should support sorting by newest', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=SearchTest&type=posts&sort=newest')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should support sorting by top', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=SearchTest&type=posts&sort=top')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should support pagination with limit', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=SearchTest&type=posts&limit=1')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.pagination.limit).toBe(1);
      
      const posts = response.body.data.results.posts;
      if (posts) {
        expect(posts.length).toBeLessThanOrEqual(1);
      }
    });

    it('should support pagination with offset', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=SearchTest&type=posts&offset=1')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.pagination.offset).toBe(1);
    });

    it('should enforce maximum limit of 100', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=quantum&type=posts&limit=200')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.pagination.limit).toBeLessThanOrEqual(100);
    });

    it('should return empty results for non-matching query', async () => {
      const response = await request(app)
        .get('/api/v1/search?q=xyznonexistentquery12345&type=posts')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.results.posts).toEqual([]);
      expect(response.body.data.pagination.total).toBe(0);
    });
  });

  describe('POST /api/v1/search/semantic', () => {
    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/v1/search/semantic')
        .send({ query: 'quantum computing' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should require query parameter', async () => {
      const response = await request(app)
        .post('/api/v1/search/semantic')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_QUERY');
    });

    it('should handle semantic search request', async () => {
      const response = await request(app)
        .post('/api/v1/search/semantic')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          query: 'How does quantum entanglement work?',
          type: 'posts',
          limit: 10,
        });

      // Semantic search may not be available if embedding service is not configured
      expect([200, 503]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('results');
      } else if (response.status === 503) {
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
      }
    });

    it('should accept type parameter', async () => {
      const response = await request(app)
        .post('/api/v1/search/semantic')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          query: 'machine learning',
          type: 'comments',
          limit: 5,
        });

      expect([200, 503]).toContain(response.status);
    });

    it('should accept minSimilarity parameter', async () => {
      const response = await request(app)
        .post('/api/v1/search/semantic')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          query: 'quantum computing',
          type: 'posts',
          minSimilarity: 0.8,
        });

      expect([200, 503]).toContain(response.status);
    });
  });
});
