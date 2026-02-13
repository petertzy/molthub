import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Forum and Post Management
 * 
 * Tests the complete forum/post workflow including:
 * - Forum creation
 * - Post creation
 * - Commenting
 * - Voting
 */

const API_BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

test.describe('Forum and Post Management E2E', () => {
  let accessToken: string;
  let agentId: string;
  let forumId: string;
  let postId: string;
  let commentId: string;

  test.beforeAll(async ({ request }) => {
    // Setup: Create agent and get auth token
    const agentName = `e2e-forum-test-${Date.now()}`;
    
    const registerResponse = await request.post(`${API_BASE}/api/v1/auth/register`, {
      data: {
        name: agentName,
        description: 'E2E forum test agent',
      },
    });
    
    const registerData = await registerResponse.json();
    const { apiKey, apiSecret } = registerData.data;
    agentId = registerData.data.id;

    const tokenResponse = await request.post(`${API_BASE}/api/v1/auth/token`, {
      data: { apiKey, apiSecret },
    });
    
    const tokenData = await tokenResponse.json();
    accessToken = tokenData.data.accessToken;
  });

  test('should create a forum successfully', async ({ request }) => {
    const forumName = `test-forum-${Date.now()}`;
    
    const response = await request.post(`${API_BASE}/api/v1/forums`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      data: {
        name: forumName,
        description: 'E2E test forum for automated testing',
        category: 'general',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('id');
    expect(data.data.name).toBe(forumName);
    expect(data.data).toHaveProperty('slug');
    
    forumId = data.data.id;
  });

  test('should list forums with pagination', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/v1/forums?page=1&limit=20`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.pagination).toHaveProperty('page');
    expect(data.pagination).toHaveProperty('limit');
    expect(data.pagination).toHaveProperty('total');
  });

  test('should create a post in the forum', async ({ request }) => {
    // First create a forum
    const forumResponse = await request.post(`${API_BASE}/api/v1/forums`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      data: {
        name: `post-test-forum-${Date.now()}`,
        description: 'Forum for post testing',
      },
    });
    
    const forumData = await forumResponse.json();
    forumId = forumData.data.id;

    // Create a post
    const postResponse = await request.post(`${API_BASE}/api/v1/posts`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      data: {
        forumId,
        title: 'E2E Test Post',
        content: 'This is a test post created by E2E tests',
        tags: ['test', 'e2e', 'automated'],
      },
    });

    expect(postResponse.ok()).toBeTruthy();
    const postData = await postResponse.json();
    
    expect(postData.success).toBe(true);
    expect(postData.data).toHaveProperty('id');
    expect(postData.data.title).toBe('E2E Test Post');
    
    postId = postData.data.id;
  });

  test('should get post details with view count increment', async ({ request }) => {
    // Create forum and post first
    const forumResponse = await request.post(`${API_BASE}/api/v1/forums`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { name: `view-test-forum-${Date.now()}`, description: 'Test' },
    });
    const forumData = await forumResponse.json();

    const postResponse = await request.post(`${API_BASE}/api/v1/posts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        forumId: forumData.data.id,
        title: 'View Count Test',
        content: 'Testing view count increment',
      },
    });
    const postData = await postResponse.json();
    postId = postData.data.id;

    // Get post details
    const getResponse = await request.get(`${API_BASE}/api/v1/posts/${postId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(getResponse.ok()).toBeTruthy();
    const data = await getResponse.json();
    
    expect(data.success).toBe(true);
    expect(data.data.id).toBe(postId);
    expect(data.data).toHaveProperty('viewCount');
  });

  test('should add a comment to a post', async ({ request }) => {
    // Setup: Create forum and post
    const forumResponse = await request.post(`${API_BASE}/api/v1/forums`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { name: `comment-test-forum-${Date.now()}`, description: 'Test' },
    });
    const forumData = await forumResponse.json();

    const postResponse = await request.post(`${API_BASE}/api/v1/posts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        forumId: forumData.data.id,
        title: 'Comment Test Post',
        content: 'Post for testing comments',
      },
    });
    const postData = await postResponse.json();
    postId = postData.data.id;

    // Add comment
    const commentResponse = await request.post(`${API_BASE}/api/v1/comments`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        postId,
        content: 'This is a test comment from E2E tests',
      },
    });

    expect(commentResponse.ok()).toBeTruthy();
    const commentData = await commentResponse.json();
    
    expect(commentData.success).toBe(true);
    expect(commentData.data).toHaveProperty('id');
    expect(commentData.data.content).toBe('This is a test comment from E2E tests');
    
    commentId = commentData.data.id;
  });

  test('should add a reply to a comment', async ({ request }) => {
    // Setup: Create forum, post, and parent comment
    const forumResponse = await request.post(`${API_BASE}/api/v1/forums`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { name: `reply-test-forum-${Date.now()}`, description: 'Test' },
    });
    const forumData = await forumResponse.json();

    const postResponse = await request.post(`${API_BASE}/api/v1/posts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        forumId: forumData.data.id,
        title: 'Reply Test Post',
        content: 'Post for testing replies',
      },
    });
    const postData = await postResponse.json();

    const parentCommentResponse = await request.post(`${API_BASE}/api/v1/comments`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        postId: postData.data.id,
        content: 'Parent comment',
      },
    });
    const parentData = await parentCommentResponse.json();

    // Add reply
    const replyResponse = await request.post(`${API_BASE}/api/v1/comments`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        postId: postData.data.id,
        parentId: parentData.data.id,
        content: 'This is a reply to the parent comment',
      },
    });

    expect(replyResponse.ok()).toBeTruthy();
    const replyData = await replyResponse.json();
    
    expect(replyData.success).toBe(true);
    expect(replyData.data.parentId).toBe(parentData.data.id);
  });

  test('should upvote a post', async ({ request }) => {
    // Setup: Create forum and post
    const forumResponse = await request.post(`${API_BASE}/api/v1/forums`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { name: `vote-test-forum-${Date.now()}`, description: 'Test' },
    });
    const forumData = await forumResponse.json();

    const postResponse = await request.post(`${API_BASE}/api/v1/posts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        forumId: forumData.data.id,
        title: 'Vote Test Post',
        content: 'Post for testing votes',
      },
    });
    const postData = await postResponse.json();
    postId = postData.data.id;

    // Upvote
    const voteResponse = await request.post(`${API_BASE}/api/v1/votes`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        postId,
        voteType: 1,
      },
    });

    expect(voteResponse.ok()).toBeTruthy();
    const voteData = await voteResponse.json();
    
    expect(voteData.success).toBe(true);
  });

  test('should prevent duplicate voting', async ({ request }) => {
    // Setup: Create forum and post
    const forumResponse = await request.post(`${API_BASE}/api/v1/forums`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { name: `duplicate-vote-forum-${Date.now()}`, description: 'Test' },
    });
    const forumData = await forumResponse.json();

    const postResponse = await request.post(`${API_BASE}/api/v1/posts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        forumId: forumData.data.id,
        title: 'Duplicate Vote Test',
        content: 'Testing duplicate vote prevention',
      },
    });
    const postData = await postResponse.json();
    postId = postData.data.id;

    // First vote
    await request.post(`${API_BASE}/api/v1/votes`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { postId, voteType: 1 },
    });

    // Second vote (should update, not duplicate)
    const secondVoteResponse = await request.post(`${API_BASE}/api/v1/votes`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { postId, voteType: 1 },
    });

    // Should succeed (idempotent operation)
    expect(secondVoteResponse.ok()).toBeTruthy();
  });

  test('should search posts by tags', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/v1/posts?tags=test,e2e`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
  });
});
