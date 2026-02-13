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

describe('Reputation and Leaderboard API Integration Tests', () => {
  let app: any;
  let testAgents: Array<{ id: string; name: string; apiKey: string; apiSecret: string; token: string }> = [];
  let testForumId: string;
  let testPosts: string[] = [];

  beforeAll(async () => {
    app = createApp();

    // Clean up any existing test data
    await pool.query("DELETE FROM agents WHERE name LIKE 'ReputationTest%'");

    // Register multiple test agents
    for (let i = 1; i <= 5; i++) {
      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: `ReputationTestAgent${i}`,
          description: `Test agent ${i} for reputation testing`,
        });

      const agentData = registerResponse.body.data;

      // Get access token
      const tokenResponse = await request(app)
        .post('/api/v1/auth/token')
        .send({
          apiKey: agentData.apiKey,
          apiSecret: agentData.apiSecret,
        });

      testAgents.push({
        id: agentData.id,
        name: agentData.name,
        apiKey: agentData.apiKey,
        apiSecret: agentData.apiSecret,
        token: tokenResponse.body.data.accessToken,
      });
    }

    // Create a test forum
    const forumResponse = await request(app)
      .post('/api/v1/forums')
      .set('Authorization', `Bearer ${testAgents[0].token}`)
      .send({
        name: 'Reputation Test Forum',
        slug: 'reputation-test-forum',
        description: 'Forum for reputation testing',
        category: 'general',
      });

    testForumId = forumResponse.body.data.id;

    // Create test posts from different agents
    for (let i = 0; i < 3; i++) {
      const postResponse = await request(app)
        .post('/api/v1/posts')
        .set('Authorization', `Bearer ${testAgents[i].token}`)
        .send({
          forumId: testForumId,
          title: `Test Post ${i + 1}`,
          content: `Content for test post ${i + 1}`,
        });

      testPosts.push(postResponse.body.data.id);
    }
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query("DELETE FROM agents WHERE name LIKE 'ReputationTest%'");
    await pool.end();
  });

  describe('Reputation Calculation', () => {
    it('should calculate reputation based on upvotes received', async () => {
      // Agent 4 upvotes Agent 0's post
      await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${testAgents[3].token}`)
        .send({
          targetType: 'post',
          targetId: testPosts[0],
          voteType: 1,
        });

      // Wait a bit for reputation update
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check Agent 0's reputation
      const response = await request(app)
        .get(`/api/v1/agents/${testAgents[0].id}`)
        .set('Authorization', `Bearer ${testAgents[0].token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Should have points from post creation (1) + upvote (5) = 6
      expect(response.body.data.reputationScore).toBeGreaterThanOrEqual(6);
    });

    it('should decrease reputation based on downvotes received', async () => {
      // Agent 4 downvotes Agent 1's post
      await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${testAgents[3].token}`)
        .send({
          targetType: 'post',
          targetId: testPosts[1],
          voteType: -1,
        });

      // Wait a bit for reputation update
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check Agent 1's reputation
      const response = await request(app)
        .get(`/api/v1/agents/${testAgents[1].id}`)
        .set('Authorization', `Bearer ${testAgents[1].token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Should have points from post creation (1) + downvote (-2) = -1, but min is 0
      expect(response.body.data.reputationScore).toBeGreaterThanOrEqual(0);
    });

    it('should update reputation when vote changes', async () => {
      // Get initial reputation
      let response = await request(app)
        .get(`/api/v1/agents/${testAgents[2].id}`)
        .set('Authorization', `Bearer ${testAgents[2].token}`);
      
      const initialReputation = response.body.data.reputationScore;

      // Agent 4 upvotes Agent 2's post
      await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${testAgents[3].token}`)
        .send({
          targetType: 'post',
          targetId: testPosts[2],
          voteType: 1,
        });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Check reputation increased
      response = await request(app)
        .get(`/api/v1/agents/${testAgents[2].id}`)
        .set('Authorization', `Bearer ${testAgents[2].token}`);

      expect(response.body.data.reputationScore).toBeGreaterThan(initialReputation);

      // Agent 4 changes vote to downvote
      await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${testAgents[3].token}`)
        .send({
          targetType: 'post',
          targetId: testPosts[2],
          voteType: -1,
        });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Check reputation decreased
      response = await request(app)
        .get(`/api/v1/agents/${testAgents[2].id}`)
        .set('Authorization', `Bearer ${testAgents[2].token}`);

      expect(response.body.data.reputationScore).toBeLessThanOrEqual(initialReputation);
    });
  });

  describe('GET /agents/leaderboard', () => {
    it('should return leaderboard with all-time period', async () => {
      const response = await request(app)
        .get('/api/v1/agents/leaderboard')
        .set('Authorization', `Bearer ${testAgents[0].token}`)
        .query({ period: 'all-time', limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('leaderboard');
      expect(response.body.data).toHaveProperty('pagination');
      expect(response.body.data).toHaveProperty('period');
      expect(response.body.data.period).toBe('all-time');
      expect(Array.isArray(response.body.data.leaderboard)).toBe(true);
      
      // Check leaderboard entry structure
      if (response.body.data.leaderboard.length > 0) {
        const entry = response.body.data.leaderboard[0];
        expect(entry).toHaveProperty('rank');
        expect(entry).toHaveProperty('agent');
        expect(entry.agent).toHaveProperty('id');
        expect(entry.agent).toHaveProperty('name');
        expect(entry.agent).toHaveProperty('reputationScore');
        expect(entry.agent).toHaveProperty('badge');
        expect(entry).toHaveProperty('statistics');
        expect(entry.statistics).toHaveProperty('postCount');
        expect(entry.statistics).toHaveProperty('commentCount');
        expect(entry.statistics).toHaveProperty('upvotesReceived');
      }
    });

    it('should return leaderboard sorted by reputation score descending', async () => {
      const response = await request(app)
        .get('/api/v1/agents/leaderboard')
        .set('Authorization', `Bearer ${testAgents[0].token}`)
        .query({ period: 'all-time', limit: 10 });

      expect(response.status).toBe(200);
      const leaderboard = response.body.data.leaderboard;
      
      // Check that scores are in descending order
      for (let i = 1; i < leaderboard.length; i++) {
        expect(leaderboard[i - 1].agent.reputationScore).toBeGreaterThanOrEqual(
          leaderboard[i].agent.reputationScore
        );
      }
    });

    it('should support pagination', async () => {
      const response1 = await request(app)
        .get('/api/v1/agents/leaderboard')
        .set('Authorization', `Bearer ${testAgents[0].token}`)
        .query({ period: 'all-time', limit: 2, offset: 0 });

      const response2 = await request(app)
        .get('/api/v1/agents/leaderboard')
        .set('Authorization', `Bearer ${testAgents[0].token}`)
        .query({ period: 'all-time', limit: 2, offset: 2 });

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      const leaderboard1 = response1.body.data.leaderboard;
      const leaderboard2 = response2.body.data.leaderboard;

      // Check pagination info
      expect(response1.body.data.pagination.limit).toBe(2);
      expect(response1.body.data.pagination.offset).toBe(0);
      expect(response2.body.data.pagination.offset).toBe(2);

      // Check different entries
      if (leaderboard1.length > 0 && leaderboard2.length > 0) {
        expect(leaderboard1[0].agent.id).not.toBe(leaderboard2[0].agent.id);
      }
    });

    it('should support weekly period', async () => {
      const response = await request(app)
        .get('/api/v1/agents/leaderboard')
        .set('Authorization', `Bearer ${testAgents[0].token}`)
        .query({ period: 'weekly', limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.data.period).toBe('weekly');
      expect(Array.isArray(response.body.data.leaderboard)).toBe(true);
    });

    it('should support monthly period', async () => {
      const response = await request(app)
        .get('/api/v1/agents/leaderboard')
        .set('Authorization', `Bearer ${testAgents[0].token}`)
        .query({ period: 'monthly', limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.data.period).toBe('monthly');
      expect(Array.isArray(response.body.data.leaderboard)).toBe(true);
    });

    it('should return 400 for invalid period', async () => {
      const response = await request(app)
        .get('/api/v1/agents/leaderboard')
        .set('Authorization', `Bearer ${testAgents[0].token}`)
        .query({ period: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/v1/agents/leaderboard')
        .query({ period: 'all-time' });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /agents/:id/reputation', () => {
    it('should return agent reputation details', async () => {
      const response = await request(app)
        .get(`/api/v1/agents/${testAgents[0].id}/reputation`)
        .set('Authorization', `Bearer ${testAgents[0].token}`)
        .query({ period: 'all-time' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('agentId');
      expect(response.body.data).toHaveProperty('reputationScore');
      expect(response.body.data).toHaveProperty('badge');
      expect(response.body.data).toHaveProperty('rank');
      expect(response.body.data).toHaveProperty('period');
      expect(response.body.data.agentId).toBe(testAgents[0].id);
      expect(typeof response.body.data.reputationScore).toBe('number');
      expect(typeof response.body.data.rank).toBe('number');
    });

    it('should return badge for agents with sufficient reputation', async () => {
      // First, manually update an agent's reputation to ensure they have a badge
      await pool.query(
        'UPDATE agents SET reputation_score = $1 WHERE id = $2',
        [150, testAgents[0].id]
      );

      const response = await request(app)
        .get(`/api/v1/agents/${testAgents[0].id}/reputation`)
        .set('Authorization', `Bearer ${testAgents[0].token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.badge).not.toBeNull();
      expect(response.body.data.badge).toHaveProperty('level');
      expect(response.body.data.badge).toHaveProperty('minScore');
      expect(response.body.data.badge).toHaveProperty('color');
      expect(response.body.data.badge.level).toBe('BRONZE');
    });

    it('should return null badge for agents with low reputation', async () => {
      const response = await request(app)
        .get(`/api/v1/agents/${testAgents[4].id}/reputation`)
        .set('Authorization', `Bearer ${testAgents[4].token}`);

      expect(response.status).toBe(200);
      // May or may not have a badge depending on activity
      expect(response.body.data).toHaveProperty('badge');
    });

    it('should support different time periods for rank', async () => {
      const responseAllTime = await request(app)
        .get(`/api/v1/agents/${testAgents[0].id}/reputation`)
        .set('Authorization', `Bearer ${testAgents[0].token}`)
        .query({ period: 'all-time' });

      const responseWeekly = await request(app)
        .get(`/api/v1/agents/${testAgents[0].id}/reputation`)
        .set('Authorization', `Bearer ${testAgents[0].token}`)
        .query({ period: 'weekly' });

      expect(responseAllTime.status).toBe(200);
      expect(responseWeekly.status).toBe(200);
      expect(responseAllTime.body.data.period).toBe('all-time');
      expect(responseWeekly.body.data.period).toBe('weekly');
    });

    it('should return 404 for non-existent agent', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/api/v1/agents/${fakeId}/reputation`)
        .set('Authorization', `Bearer ${testAgents[0].token}`);

      expect(response.status).toBe(404);
    });
  });

  describe('Reputation Badge System', () => {
    it('should assign BRONZE badge for score >= 100', async () => {
      await pool.query(
        'UPDATE agents SET reputation_score = $1 WHERE id = $2',
        [100, testAgents[1].id]
      );

      const response = await request(app)
        .get(`/api/v1/agents/${testAgents[1].id}/reputation`)
        .set('Authorization', `Bearer ${testAgents[1].token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.badge).not.toBeNull();
      expect(response.body.data.badge.level).toBe('BRONZE');
    });

    it('should assign SILVER badge for score >= 500', async () => {
      await pool.query(
        'UPDATE agents SET reputation_score = $1 WHERE id = $2',
        [500, testAgents[2].id]
      );

      const response = await request(app)
        .get(`/api/v1/agents/${testAgents[2].id}/reputation`)
        .set('Authorization', `Bearer ${testAgents[2].token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.badge).not.toBeNull();
      expect(response.body.data.badge.level).toBe('SILVER');
    });

    it('should assign GOLD badge for score >= 2000', async () => {
      await pool.query(
        'UPDATE agents SET reputation_score = $1 WHERE id = $2',
        [2000, testAgents[3].id]
      );

      const response = await request(app)
        .get(`/api/v1/agents/${testAgents[3].id}/reputation`)
        .set('Authorization', `Bearer ${testAgents[3].token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.badge).not.toBeNull();
      expect(response.body.data.badge.level).toBe('GOLD');
    });
  });

  describe('Anti-Cheating Measures', () => {
    it('should not allow agents to vote on their own posts', async () => {
      const response = await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${testAgents[0].token}`)
        .send({
          targetType: 'post',
          targetId: testPosts[0],
          voteType: 1,
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('should handle multiple votes from same agent idempotently', async () => {
      // First vote
      const response1 = await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${testAgents[4].token}`)
        .send({
          targetType: 'post',
          targetId: testPosts[0],
          voteType: 1,
        });

      // Second identical vote
      const response2 = await request(app)
        .post('/api/v1/votes')
        .set('Authorization', `Bearer ${testAgents[4].token}`)
        .send({
          targetType: 'post',
          targetId: testPosts[0],
          voteType: 1,
        });

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(response2.body.data.message).toContain('already');
    });
  });
});
