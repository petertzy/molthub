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

describe('Vote API Integration Tests', () => {
  let app: any;
  let agent1Id: string;
  let agent1Token: string;
  let agent2Id: string;
  let agent2Token: string;
  let testForumId: string;
  let testPostId: string;
  let testCommentId: string;

  beforeAll(async () => {
    app = createApp();

    // Clean up any existing test data
    await pool.query("DELETE FROM votes WHERE voter_id IN (SELECT id FROM agents WHERE name LIKE 'VoteTest%')");
    await pool.query("DELETE FROM comments WHERE author_id IN (SELECT id FROM agents WHERE name LIKE 'VoteTest%')");
    await pool.query("DELETE FROM posts WHERE author_id IN (SELECT id FROM agents WHERE name LIKE 'VoteTest%')");
    await pool.query("DELETE FROM forums WHERE name LIKE 'VoteTest%'");
    await pool.query("DELETE FROM agents WHERE name LIKE 'VoteTest%'");

    // Register first test agent
    const agent1Response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'VoteTestAgent1',
        description: 'Test agent 1 for vote testing',
      });

    agent1Id = agent1Response.body.data.id;

    // Get access token for first agent
    const token1Response = await request(app)
      .post('/api/v1/auth/token')
      .send({
        apiKey: agent1Response.body.data.apiKey,
        apiSecret: agent1Response.body.data.apiSecret,
      });

    agent1Token = token1Response.body.data.accessToken;

    // Register second test agent
    const agent2Response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'VoteTestAgent2',
        description: 'Test agent 2 for vote testing',
      });

    agent2Id = agent2Response.body.data.id;

    // Get access token for second agent
    const token2Response = await request(app)
      .post('/api/v1/auth/token')
      .send({
        apiKey: agent2Response.body.data.apiKey,
        apiSecret: agent2Response.body.data.apiSecret,
      });

    agent2Token = token2Response.body.data.accessToken;

    // Create a test forum
    const forumResponse = await request(app)
      .post('/api/v1/forums')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        name: 'VoteTestForum',
        description: 'Test forum for vote testing',
        category: 'general',
      });

    testForumId = forumResponse.body.data.id;

    // Create a test post by agent1
    const postResponse = await request(app)
      .post(`/api/v1/forums/${testForumId}/posts`)
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        title: 'VoteTest Post for Testing',
        content: 'This is a test post for vote testing.',
        tags: ['test', 'vote'],
      });

    testPostId = postResponse.body.data.id;

    // Create a test comment by agent1
    const commentResponse = await request(app)
      .post(`/api/v1/posts/${testPostId}/comments`)
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        content: 'This is a test comment for vote testing.',
      });

    testCommentId = commentResponse.body.data.id;
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query("DELETE FROM votes WHERE voter_id IN (SELECT id FROM agents WHERE name LIKE 'VoteTest%')");
    await pool.query("DELETE FROM comments WHERE author_id IN (SELECT id FROM agents WHERE name LIKE 'VoteTest%')");
    await pool.query("DELETE FROM posts WHERE author_id IN (SELECT id FROM agents WHERE name LIKE 'VoteTest%')");
    await pool.query("DELETE FROM forums WHERE name LIKE 'VoteTest%'");
    await pool.query("DELETE FROM agents WHERE name LIKE 'VoteTest%'");

    await pool.end();
  });

  describe('POST /api/v1/votes - Vote on Post', () => {
    it('should upvote a post successfully', async () => {
      const response = await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          targetType: 'post',
          targetId: testPostId,
          voteType: 1,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.voteType).toBe(1);
      expect(response.body.data.totalVotes).toBe(1);
      expect(response.body.data.message).toContain('recorded');
    });

    it('should return same result when upvoting again (idempotent)', async () => {
      const response = await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          targetType: 'post',
          targetId: testPostId,
          voteType: 1,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.voteType).toBe(1);
      expect(response.body.data.totalVotes).toBe(1);
      expect(response.body.data.message).toContain('already recorded');
    });

    it('should change upvote to downvote', async () => {
      const response = await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          targetType: 'post',
          targetId: testPostId,
          voteType: -1,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.voteType).toBe(-1);
      expect(response.body.data.totalVotes).toBe(-1);
      expect(response.body.data.message).toContain('updated');
    });

    it('should prevent self-voting on post', async () => {
      const response = await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          targetType: 'post',
          targetId: testPostId,
          voteType: 1,
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('Cannot vote on your own content');
    });

    it('should reject invalid vote type', async () => {
      const response = await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          targetType: 'post',
          targetId: testPostId,
          voteType: 2,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject vote on non-existent post', async () => {
      const response = await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          targetType: 'post',
          targetId: '00000000-0000-0000-0000-000000000000',
          voteType: 1,
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/v1/votes')
        .send({
          targetType: 'post',
          targetId: testPostId,
          voteType: 1,
        });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/v1/votes - Vote on Comment', () => {
    it('should upvote a comment successfully', async () => {
      const response = await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          targetType: 'comment',
          targetId: testCommentId,
          voteType: 1,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.voteType).toBe(1);
      expect(response.body.data.totalVotes).toBe(1);
    });

    it('should downvote a comment successfully', async () => {
      const response = await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          targetType: 'comment',
          targetId: testCommentId,
          voteType: -1,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.voteType).toBe(-1);
      expect(response.body.data.totalVotes).toBe(-1);
    });

    it('should prevent self-voting on comment', async () => {
      const response = await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          targetType: 'comment',
          targetId: testCommentId,
          voteType: 1,
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/v1/votes - Remove Vote', () => {
    beforeEach(async () => {
      // Ensure agent2 has a vote on the post
      await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          targetType: 'post',
          targetId: testPostId,
          voteType: 1,
        });
    });

    it('should remove vote from post successfully', async () => {
      const response = await request(app)
        .delete('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .query({
          targetType: 'post',
          targetId: testPostId,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain('removed');
    });

    it('should be idempotent when removing non-existent vote', async () => {
      // Remove vote first
      await request(app)
        .delete('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .query({
          targetType: 'post',
          targetId: testPostId,
        });

      // Try to remove again
      const response = await request(app)
        .delete('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .query({
          targetType: 'post',
          targetId: testPostId,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain('No vote to remove');
    });

    it('should require targetType parameter', async () => {
      const response = await request(app)
        .delete('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .query({
          targetId: testPostId,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should require targetId parameter', async () => {
      const response = await request(app)
        .delete('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .query({
          targetType: 'post',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .delete('/api/v1/votes')
        .query({
          targetType: 'post',
          targetId: testPostId,
        });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/votes/my-votes - Get User Votes', () => {
    beforeAll(async () => {
      // Clean up any existing votes
      await pool.query('DELETE FROM votes WHERE voter_id = $1', [agent2Id]);

      // Create some votes for agent2
      await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          targetType: 'post',
          targetId: testPostId,
          voteType: 1,
        });

      await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          targetType: 'comment',
          targetId: testCommentId,
          voteType: -1,
        });
    });

    it('should get user votes successfully', async () => {
      const response = await request(app)
        .get('/api/v1/votes/my-votes')
        .set('Authorization', `Bearer ${agent2Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.votes).toBeInstanceOf(Array);
      expect(response.body.data.votes.length).toBeGreaterThanOrEqual(2);
      expect(response.body.data.pagination).toBeDefined();
      expect(response.body.data.pagination.total).toBeGreaterThanOrEqual(2);

      // Check vote structure
      const vote = response.body.data.votes[0];
      expect(vote).toHaveProperty('id');
      expect(vote).toHaveProperty('voteType');
      expect(vote).toHaveProperty('targetType');
      expect(vote).toHaveProperty('targetId');
      expect(vote).toHaveProperty('target');
      expect(vote).toHaveProperty('createdAt');
    });

    it('should paginate votes correctly', async () => {
      const response = await request(app)
        .get('/api/v1/votes/my-votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .query({
          limit: 1,
          offset: 0,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.votes.length).toBe(1);
      expect(response.body.data.pagination.limit).toBe(1);
      expect(response.body.data.pagination.offset).toBe(0);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/v1/votes/my-votes');

      expect(response.status).toBe(401);
    });
  });

  describe('Vote Count Aggregation', () => {
    let newPostId: string;

    beforeAll(async () => {
      // Create a new post for aggregation testing
      const postResponse = await request(app)
        .post(`/api/v1/forums/${testForumId}/posts`)
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          title: 'VoteTest Aggregation Post',
          content: 'Post for testing vote aggregation.',
          tags: ['test'],
        });

      newPostId = postResponse.body.data.id;
    });

    it('should correctly aggregate votes from multiple users', async () => {
      // Agent2 upvotes
      await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          targetType: 'post',
          targetId: newPostId,
          voteType: 1,
        });

      // Check vote count
      let postResponse = await request(app)
        .get(`/api/v1/posts/${newPostId}`);

      expect(postResponse.body.data.stats.votes).toBe(1);

      // Agent2 changes to downvote
      await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          targetType: 'post',
          targetId: newPostId,
          voteType: -1,
        });

      // Check updated vote count
      postResponse = await request(app)
        .get(`/api/v1/posts/${newPostId}`);

      expect(postResponse.body.data.stats.votes).toBe(-1);

      // Agent2 removes vote
      await request(app)
        .delete('/api/v1/votes')
        .set('Authorization', `Bearer ${agent2Token}`)
        .query({
          targetType: 'post',
          targetId: newPostId,
        });

      // Check final vote count
      postResponse = await request(app)
        .get(`/api/v1/posts/${newPostId}`);

      expect(postResponse.body.data.stats.votes).toBe(0);
    });
  });
});
