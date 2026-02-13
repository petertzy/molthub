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

describe('Notification API Integration Tests', () => {
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
    await pool.query("DELETE FROM notifications WHERE recipient_id IN (SELECT id FROM agents WHERE name LIKE 'NotifTest%')");
    await pool.query("DELETE FROM agent_subscriptions WHERE agent_id IN (SELECT id FROM agents WHERE name LIKE 'NotifTest%')");
    await pool.query("DELETE FROM subscription_threads WHERE agent_id IN (SELECT id FROM agents WHERE name LIKE 'NotifTest%')");
    await pool.query("DELETE FROM posts WHERE author_id IN (SELECT id FROM agents WHERE name LIKE 'NotifTest%')");
    await pool.query("DELETE FROM forums WHERE name LIKE 'NotifTest%'");
    await pool.query("DELETE FROM agents WHERE name LIKE 'NotifTest%'");

    // Register test agents
    const agent1Response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'NotifTestAgent1',
        description: 'Test agent 1 for notification testing',
      });

    agent1Id = agent1Response.body.data.id;
    const agent1ApiKey = agent1Response.body.data.apiKey;
    const agent1ApiSecret = agent1Response.body.data.apiSecret;

    const token1Response = await request(app)
      .post('/api/v1/auth/token')
      .send({
        apiKey: agent1ApiKey,
        apiSecret: agent1ApiSecret,
      });

    agent1Token = token1Response.body.data.accessToken;

    const agent2Response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'NotifTestAgent2',
        description: 'Test agent 2 for notification testing',
      });

    agent2Id = agent2Response.body.data.id;
    const agent2ApiKey = agent2Response.body.data.apiKey;
    const agent2ApiSecret = agent2Response.body.data.apiSecret;

    const token2Response = await request(app)
      .post('/api/v1/auth/token')
      .send({
        apiKey: agent2ApiKey,
        apiSecret: agent2ApiSecret,
      });

    agent2Token = token2Response.body.data.accessToken;

    // Create a test forum
    const forumResponse = await request(app)
      .post('/api/v1/forums')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        name: 'NotifTestForum',
        description: 'Test forum for notification testing',
        category: 'test',
      });

    testForumId = forumResponse.body.data.id;
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query("DELETE FROM notifications WHERE recipient_id IN (SELECT id FROM agents WHERE name LIKE 'NotifTest%')");
    await pool.query("DELETE FROM agent_subscriptions WHERE agent_id IN (SELECT id FROM agents WHERE name LIKE 'NotifTest%')");
    await pool.query("DELETE FROM subscription_threads WHERE agent_id IN (SELECT id FROM agents WHERE name LIKE 'NotifTest%')");
    await pool.query("DELETE FROM posts WHERE author_id IN (SELECT id FROM agents WHERE name LIKE 'NotifTest%')");
    await pool.query("DELETE FROM forums WHERE name LIKE 'NotifTest%'");
    await pool.query("DELETE FROM agents WHERE name LIKE 'NotifTest%'");
    await pool.end();
  });

  describe('Forum Subscriptions', () => {
    it('should subscribe to a forum successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/notifications/subscriptions/forums/${testForumId}`)
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          notifyOnPost: true,
          notifyOnComment: false,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.agentId).toBe(agent2Id);
      expect(response.body.data.forumId).toBe(testForumId);
      expect(response.body.data.notifyOnPost).toBe(true);
      expect(response.body.data.notifyOnComment).toBe(false);
    });

    it('should get forum subscriptions', async () => {
      const response = await request(app)
        .get('/api/v1/notifications/subscriptions/forums')
        .set('Authorization', `Bearer ${agent2Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].forumId).toBe(testForumId);
    });

    it('should unsubscribe from a forum successfully', async () => {
      const response = await request(app)
        .delete(`/api/v1/notifications/subscriptions/forums/${testForumId}`)
        .set('Authorization', `Bearer ${agent2Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 when unsubscribing from non-existent subscription', async () => {
      const response = await request(app)
        .delete(`/api/v1/notifications/subscriptions/forums/${testForumId}`)
        .set('Authorization', `Bearer ${agent2Token}`);

      expect(response.status).toBe(404);
    });
  });

  describe('Post Subscriptions', () => {
    beforeAll(async () => {
      // Create a test post
      const postResponse = await request(app)
        .post('/api/v1/posts')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          forumId: testForumId,
          title: 'Test Post for Notifications',
          content: 'This is a test post for notification testing',
          tags: ['test'],
        });

      testPostId = postResponse.body.data.id;
    });

    it('should subscribe to a post successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/notifications/subscriptions/posts/${testPostId}`)
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          notifyOnReply: true,
          notifyOnVote: false,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.postId).toBe(testPostId);
      expect(response.body.data.agentId).toBe(agent2Id);
    });

    it('should get thread subscriptions', async () => {
      const response = await request(app)
        .get('/api/v1/notifications/subscriptions/threads')
        .set('Authorization', `Bearer ${agent2Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should unsubscribe from a post successfully', async () => {
      const response = await request(app)
        .delete(`/api/v1/notifications/subscriptions/posts/${testPostId}`)
        .set('Authorization', `Bearer ${agent2Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Notification Preferences', () => {
    it('should get notification preferences', async () => {
      const response = await request(app)
        .get('/api/v1/notifications/preferences')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should update notification preference', async () => {
      const response = await request(app)
        .put('/api/v1/notifications/preferences/forum_post')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          enabled: false,
          pushEnabled: false,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.notificationType).toBe('forum_post');
      expect(response.body.data.enabled).toBe(false);
      expect(response.body.data.pushEnabled).toBe(false);
    });

    it('should reject invalid notification type', async () => {
      const response = await request(app)
        .put('/api/v1/notifications/preferences/invalid_type')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          enabled: true,
        });

      expect(response.status).toBe(400);
    });
  });

  describe('Notification Management', () => {
    let notificationId: string;

    beforeAll(async () => {
      // Create a notification directly via database for testing
      const result = await pool.query(
        `INSERT INTO notifications (recipient_id, sender_id, type, title, content, post_id)
         VALUES ($1, $2, 'post_comment', 'Test notification', 'Test content', $3)
         RETURNING id`,
        [agent1Id, agent2Id, testPostId]
      );
      notificationId = result.rows[0].id;
    });

    it('should get notifications', async () => {
      const response = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should get unread notification count', async () => {
      const response = await request(app)
        .get('/api/v1/notifications/unread/count')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('count');
      expect(typeof response.body.data.count).toBe('number');
    });

    it('should mark notification as read', async () => {
      const response = await request(app)
        .put(`/api/v1/notifications/${notificationId}/read`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.isRead).toBe(true);
      expect(response.body.data.readAt).toBeDefined();
    });

    it('should mark notification as unread', async () => {
      const response = await request(app)
        .put(`/api/v1/notifications/${notificationId}/unread`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.isRead).toBe(false);
      expect(response.body.data.readAt).toBeNull();
    });

    it('should mark all notifications as read', async () => {
      const response = await request(app)
        .put('/api/v1/notifications/read-all')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('count');
      expect(typeof response.body.data.count).toBe('number');
    });

    it('should delete notification', async () => {
      const response = await request(app)
        .delete(`/api/v1/notifications/${notificationId}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should filter notifications by read status', async () => {
      const response = await request(app)
        .get('/api/v1/notifications?isRead=false')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should filter notifications by type', async () => {
      const response = await request(app)
        .get('/api/v1/notifications?types=post_comment')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should paginate notifications', async () => {
      const response = await request(app)
        .get('/api/v1/notifications?limit=10&offset=0')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('Authentication', () => {
    it('should reject requests without authentication', async () => {
      const response = await request(app)
        .get('/api/v1/notifications');

      expect(response.status).toBe(401);
    });

    it('should reject requests with invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', 'Bearer invalid_token');

      expect(response.status).toBe(401);
    });
  });
});
