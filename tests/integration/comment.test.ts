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

describe('Comment API Integration Tests', () => {
  let app: any;
  let testAgentId: string;
  let testApiKey: string;
  let testApiSecret: string;
  let accessToken: string;
  let testForumId: string;
  let testPostId: string;
  let testCommentId: string;
  let testReplyId: string;
  let anotherAgentId: string;
  let anotherAccessToken: string;

  beforeAll(async () => {
    app = createApp();

    // Clean up any existing test data
    await pool.query("DELETE FROM comments WHERE content LIKE 'CommentTest%'");
    await pool.query("DELETE FROM posts WHERE title LIKE 'CommentTest%'");
    await pool.query("DELETE FROM forums WHERE name LIKE 'CommentTest%'");
    await pool.query("DELETE FROM agents WHERE name LIKE 'CommentTest%'");

    // Register first test agent
    const agentResponse = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'CommentTestAgent1',
        description: 'Test agent for comment testing',
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
        name: 'CommentTestAgent2',
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
        name: 'CommentTestForum',
        description: 'Test forum for comment testing',
        category: 'general',
      });

    testForumId = forumResponse.body.data.id;

    // Create a test post
    const postResponse = await request(app)
      .post(`/api/v1/forums/${testForumId}/posts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'CommentTest: Post for Comments',
        content: 'This is a post where we will test comments functionality.',
        tags: ['test', 'comments'],
      });

    testPostId = postResponse.body.data.id;
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query("DELETE FROM comments WHERE content LIKE 'CommentTest%'");
    if (testPostId) {
      await pool.query('DELETE FROM posts WHERE id = $1', [testPostId]);
    }
    await pool.query("DELETE FROM posts WHERE title LIKE 'CommentTest%'");
    if (testForumId) {
      await pool.query('DELETE FROM forums WHERE id = $1', [testForumId]);
    }
    await pool.query("DELETE FROM forums WHERE name LIKE 'CommentTest%'");
    await pool.query('DELETE FROM agents WHERE id = ANY($1)', [[testAgentId, anotherAgentId]]);
    await pool.end();
  });

  describe('POST /api/v1/posts/:id/comments', () => {
    it('should create a new comment successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/posts/${testPostId}/comments`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          content: 'CommentTest: This is my first comment on this post.',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.content).toBe('CommentTest: This is my first comment on this post.');
      expect(response.body.data.postId).toBe(testPostId);
      expect(response.body.data.authorId).toBe(testAgentId);
      expect(response.body.data.parentId).toBeNull();

      testCommentId = response.body.data.id;
    });

    it('should create a nested reply successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/posts/${testPostId}/comments`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          content: 'CommentTest: This is a reply to the first comment.',
          parentCommentId: testCommentId,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.parentId).toBe(testCommentId);

      testReplyId = response.body.data.id;
    });

    it('should fail to create comment without authentication', async () => {
      const response = await request(app)
        .post(`/api/v1/posts/${testPostId}/comments`)
        .send({
          content: 'CommentTest: Unauthorized comment.',
        });

      expect(response.status).toBe(401);
    });

    it('should fail to create comment on non-existent post', async () => {
      const response = await request(app)
        .post('/api/v1/posts/00000000-0000-0000-0000-000000000000/comments')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          content: 'CommentTest: Comment on non-existent post.',
        });

      expect(response.status).toBe(404);
      expect(response.body.error.message).toContain('Post not found');
    });

    it('should fail to create comment with invalid parent', async () => {
      const response = await request(app)
        .post(`/api/v1/posts/${testPostId}/comments`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          content: 'CommentTest: Comment with invalid parent.',
          parentCommentId: '00000000-0000-0000-0000-000000000000',
        });

      expect(response.status).toBe(404);
      expect(response.body.error.message).toContain('Parent comment not found');
    });
  });

  describe('GET /api/v1/posts/:id/comments', () => {
    it('should get all comments for a post', async () => {
      const response = await request(app)
        .get(`/api/v1/posts/${testPostId}/comments`)
        .query({ limit: 50 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('comments');
      expect(Array.isArray(response.body.data.comments)).toBe(true);
      expect(response.body.data.comments.length).toBeGreaterThanOrEqual(2);
      expect(response.body.data).toHaveProperty('pagination');
    });

    it('should get comments with thread view', async () => {
      const response = await request(app)
        .get(`/api/v1/posts/${testPostId}/comments`)
        .query({ threadView: 'true', limit: 50 });

      expect(response.status).toBe(200);
      expect(response.body.data.comments.length).toBeGreaterThan(0);
      // Top-level comments should have replies
      const topLevelComment = response.body.data.comments.find((c: any) => c.id === testCommentId);
      expect(topLevelComment).toBeDefined();
      expect(topLevelComment.replies).toBeDefined();
      expect(Array.isArray(topLevelComment.replies)).toBe(true);
      expect(topLevelComment.replies.length).toBeGreaterThan(0);
    });

    it('should sort comments by newest', async () => {
      const response = await request(app)
        .get(`/api/v1/posts/${testPostId}/comments`)
        .query({ sort: 'newest' });

      expect(response.status).toBe(200);
      const comments = response.body.data.comments;
      for (let i = 0; i < comments.length - 1; i++) {
        const current = new Date(comments[i].createdAt);
        const next = new Date(comments[i + 1].createdAt);
        expect(current >= next).toBe(true);
      }
    });
  });

  describe('GET /api/v1/comments/:id', () => {
    it('should get comment details successfully', async () => {
      const response = await request(app)
        .get(`/api/v1/comments/${testCommentId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(testCommentId);
      expect(response.body.data.content).toContain('CommentTest:');
      expect(response.body.data).toHaveProperty('author');
      expect(response.body.data).toHaveProperty('postId');
    });

    it('should fail to get non-existent comment', async () => {
      const response = await request(app)
        .get('/api/v1/comments/00000000-0000-0000-0000-000000000000');

      expect(response.status).toBe(404);
      expect(response.body.error.message).toContain('Comment not found');
    });
  });

  describe('GET /api/v1/comments/:id/replies', () => {
    it('should get replies to a comment', async () => {
      const response = await request(app)
        .get(`/api/v1/comments/${testCommentId}/replies`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('comments');
      expect(Array.isArray(response.body.data.comments)).toBe(true);
      expect(response.body.data.comments.length).toBeGreaterThan(0);
      expect(response.body.data.comments[0].parentId).toBe(testCommentId);
    });
  });

  describe('PUT /api/v1/comments/:id', () => {
    it('should update comment successfully by author', async () => {
      const response = await request(app)
        .put(`/api/v1/comments/${testCommentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          content: 'CommentTest: This is my updated first comment on this post.',
          editReason: 'Improved wording',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.content).toBe('CommentTest: This is my updated first comment on this post.');
    });

    it('should fail to update comment by non-author', async () => {
      const response = await request(app)
        .put(`/api/v1/comments/${testCommentId}`)
        .set('Authorization', `Bearer ${anotherAccessToken}`)
        .send({
          content: 'CommentTest: Unauthorized update.',
        });

      expect(response.status).toBe(403);
      expect(response.body.error.message).toContain('Only the comment author can edit the comment');
    });

    it('should fail to update comment without authentication', async () => {
      const response = await request(app)
        .put(`/api/v1/comments/${testCommentId}`)
        .send({
          content: 'CommentTest: Unauthorized update.',
        });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/comments/:id/history', () => {
    it('should get edit history for comment', async () => {
      const response = await request(app)
        .get(`/api/v1/comments/${testCommentId}/history`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0]).toHaveProperty('previousContent');
      expect(response.body.data[0]).toHaveProperty('editReason');
      expect(response.body.data[0].editReason).toBe('Improved wording');
    });
  });

  describe('DELETE /api/v1/comments/:id', () => {
    it('should fail to delete comment by non-author', async () => {
      const response = await request(app)
        .delete(`/api/v1/comments/${testCommentId}`)
        .set('Authorization', `Bearer ${anotherAccessToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error.message).toContain('Only the comment author can delete the comment');
    });

    it('should delete reply successfully by author', async () => {
      const response = await request(app)
        .delete(`/api/v1/comments/${testReplyId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toBe('Comment deleted successfully');
    });

    it('should delete comment successfully by author', async () => {
      const response = await request(app)
        .delete(`/api/v1/comments/${testCommentId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toBe('Comment deleted successfully');
    });

    it('should fail to get deleted comment', async () => {
      const response = await request(app)
        .get(`/api/v1/comments/${testCommentId}`);

      expect(response.status).toBe(404);
      expect(response.body.error.message).toContain('Comment not found');
    });
  });
});
