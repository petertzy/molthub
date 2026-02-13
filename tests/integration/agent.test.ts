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

describe('Agent API Integration Tests', () => {
  let app: any;
  let testAgentId: string;
  let testApiKey: string;
  let testApiSecret: string;
  let accessToken: string;
  let testForumId: string;
  let testPostId: string;

  beforeAll(async () => {
    app = createApp();

    // Clean up any existing test data
    await pool.query("DELETE FROM agents WHERE name LIKE 'AgentAPITest%'");

    // Register a test agent
    const registerResponse = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'AgentAPITestUser',
        description: 'Test agent for Agent API testing',
      });

    testAgentId = registerResponse.body.data.id;
    testApiKey = registerResponse.body.data.apiKey;
    testApiSecret = registerResponse.body.data.apiSecret;

    // Get access token
    const tokenResponse = await request(app)
      .post('/api/v1/auth/token')
      .send({
        apiKey: testApiKey,
        apiSecret: testApiSecret,
      });

    accessToken = tokenResponse.body.data.accessToken;

    // Create a test forum
    const forumResult = await pool.query(
      `INSERT INTO forums (id, name, slug, creator_id, description) 
       VALUES (uuid_generate_v4(), 'test-forum', 'test-forum', $1, 'Test Forum') 
       RETURNING id`,
      [testAgentId],
    );
    testForumId = forumResult.rows[0].id;

    // Create test posts
    const postResult = await pool.query(
      `INSERT INTO posts (id, forum_id, author_id, title, content) 
       VALUES (uuid_generate_v4(), $1, $2, 'Test Post 1', 'This is test post 1') 
       RETURNING id`,
      [testForumId, testAgentId],
    );
    testPostId = postResult.rows[0].id;

    // Add some votes
    await pool.query(
      `INSERT INTO votes (voter_id, post_id, vote_type) VALUES ($1, $2, 1)`,
      [testAgentId, testPostId],
    );

    // Add some comments
    await pool.query(
      `INSERT INTO comments (post_id, author_id, content) VALUES ($1, $2, 'Test comment')`,
      [testPostId, testAgentId],
    );

    // Create additional posts for pagination testing
    for (let i = 2; i <= 5; i++) {
      await pool.query(
        `INSERT INTO posts (forum_id, author_id, title, content, vote_count) 
         VALUES ($1, $2, $3, $4, $5)`,
        [testForumId, testAgentId, `Test Post ${i}`, `Content for post ${i}`, i],
      );
    }
  });

  afterAll(async () => {
    // Clean up test data
    if (testPostId) {
      await pool.query('DELETE FROM votes WHERE post_id = $1', [testPostId]);
      await pool.query('DELETE FROM comments WHERE post_id = $1', [testPostId]);
    }
    if (testForumId) {
      await pool.query('DELETE FROM posts WHERE forum_id = $1', [testForumId]);
      await pool.query('DELETE FROM forums WHERE id = $1', [testForumId]);
    }
    if (testAgentId) {
      await pool.query('DELETE FROM agents WHERE id = $1', [testAgentId]);
    }
    await pool.end();
  });

  describe('GET /api/v1/agents/:id', () => {
    it('should get agent profile successfully', async () => {
      const response = await request(app)
        .get(`/api/v1/agents/${testAgentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', testAgentId);
      expect(response.body.data).toHaveProperty('name', 'AgentAPITestUser');
      expect(response.body.data).toHaveProperty('reputationScore');
      expect(response.body.data).toHaveProperty('statistics');
      expect(response.body.data.statistics).toHaveProperty('postCount');
      expect(response.body.data.statistics).toHaveProperty('commentCount');
      expect(response.body.data.statistics.postCount).toBeGreaterThan(0);
      expect(response.body.data).toHaveProperty('topForums');
      expect(response.body.data.topForums).toContain('test-forum');
    });

    it('should return 401 when not authenticated', async () => {
      const response = await request(app)
        .get(`/api/v1/agents/${testAgentId}`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 for non-existent agent', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/api/v1/agents/${nonExistentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should use cache on subsequent requests', async () => {
      // First request
      const response1 = await request(app)
        .get(`/api/v1/agents/${testAgentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Second request (should use cache)
      const response2 = await request(app)
        .get(`/api/v1/agents/${testAgentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response1.body.data).toEqual(response2.body.data);
    });
  });

  describe('GET /api/v1/agents/:id/stats', () => {
    it('should get agent statistics successfully', async () => {
      const response = await request(app)
        .get(`/api/v1/agents/${testAgentId}/stats`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('reputationScore');
      expect(response.body.data).toHaveProperty('postsCreated');
      expect(response.body.data).toHaveProperty('commentsCreated');
      expect(response.body.data).toHaveProperty('upvotesReceived');
      expect(response.body.data).toHaveProperty('downvotesReceived');
      expect(response.body.data).toHaveProperty('averageCommentPerPost');
      expect(response.body.data).toHaveProperty('joined');
      expect(response.body.data).toHaveProperty('activity7Days');
      expect(response.body.data.activity7Days).toHaveProperty('posts');
      expect(response.body.data.activity7Days).toHaveProperty('comments');
      expect(response.body.data.activity7Days).toHaveProperty('votes');
      expect(response.body.data.postsCreated).toBeGreaterThan(0);
    });

    it('should return 401 when not authenticated', async () => {
      const response = await request(app)
        .get(`/api/v1/agents/${testAgentId}/stats`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 for non-existent agent', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/api/v1/agents/${nonExistentId}/stats`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should calculate averageCommentPerPost correctly', async () => {
      const response = await request(app)
        .get(`/api/v1/agents/${testAgentId}/stats`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const { postsCreated, commentsCreated, averageCommentPerPost } = response.body.data;
      const expectedAverage = parseFloat((commentsCreated / postsCreated).toFixed(2));
      expect(averageCommentPerPost).toBe(expectedAverage);
    });
  });

  describe('GET /api/v1/agents/:id/posts', () => {
    it('should get agent posts with default pagination', async () => {
      const response = await request(app)
        .get(`/api/v1/agents/${testAgentId}/posts`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('posts');
      expect(response.body.data).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data.posts)).toBe(true);
      expect(response.body.data.posts.length).toBeGreaterThan(0);
      expect(response.body.data.pagination).toHaveProperty('total');
      expect(response.body.data.pagination).toHaveProperty('limit', 20);
      expect(response.body.data.pagination).toHaveProperty('offset', 0);
      expect(response.body.data.pagination).toHaveProperty('hasMore');

      // Check post structure
      const post = response.body.data.posts[0];
      expect(post).toHaveProperty('id');
      expect(post).toHaveProperty('title');
      expect(post).toHaveProperty('content');
      expect(post).toHaveProperty('forum');
      expect(post.forum).toHaveProperty('id');
      expect(post.forum).toHaveProperty('name');
      expect(post).toHaveProperty('createdAt');
      expect(post).toHaveProperty('votes');
      expect(post).toHaveProperty('comments');
    });

    it('should support custom limit and offset', async () => {
      const response = await request(app)
        .get(`/api/v1/agents/${testAgentId}/posts?limit=2&offset=1`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.pagination.limit).toBe(2);
      expect(response.body.data.pagination.offset).toBe(1);
      expect(response.body.data.posts.length).toBeLessThanOrEqual(2);
    });

    it('should support sorting by different fields', async () => {
      const response = await request(app)
        .get(`/api/v1/agents/${testAgentId}/posts?sort=vote_count&order=desc`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      const posts = response.body.data.posts;
      // Verify posts are sorted by vote_count in descending order
      for (let i = 1; i < posts.length; i++) {
        expect(posts[i - 1].votes).toBeGreaterThanOrEqual(posts[i].votes);
      }
    });

    it('should handle ascending order', async () => {
      const response = await request(app)
        .get(`/api/v1/agents/${testAgentId}/posts?sort=created_at&order=asc`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      const posts = response.body.data.posts;
      // Verify posts are sorted by created_at in ascending order
      for (let i = 1; i < posts.length; i++) {
        const date1 = new Date(posts[i - 1].createdAt);
        const date2 = new Date(posts[i].createdAt);
        expect(date1.getTime()).toBeLessThanOrEqual(date2.getTime());
      }
    });

    it('should return 401 when not authenticated', async () => {
      const response = await request(app)
        .get(`/api/v1/agents/${testAgentId}/posts`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 for non-existent agent', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/api/v1/agents/${nonExistentId}/posts`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should enforce max limit of 100', async () => {
      const response = await request(app)
        .get(`/api/v1/agents/${testAgentId}/posts?limit=200`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.pagination.limit).toBe(100);
    });

    it('should handle negative offset gracefully', async () => {
      const response = await request(app)
        .get(`/api/v1/agents/${testAgentId}/posts?offset=-5`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.pagination.offset).toBe(0);
    });

    it('should calculate hasMore correctly', async () => {
      const response = await request(app)
        .get(`/api/v1/agents/${testAgentId}/posts?limit=2`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const { posts, pagination } = response.body.data;
      const expectedHasMore = pagination.offset + posts.length < pagination.total;
      expect(pagination.hasMore).toBe(expectedHasMore);
    });
  });
});
