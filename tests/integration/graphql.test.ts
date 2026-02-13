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
import { createServer } from 'http';
import { env } from '@config/env';
import { createGraphQLServer, createGraphQLMiddleware } from '@/modules/graphql/server';

describe('GraphQL API Integration Tests', () => {
  let app: any;
  let httpServer: any;
  let testAgentId: string;
  let testApiKey: string;
  let testApiSecret: string;
  let accessToken: string;
  let testForumId: string;
  let testPostId: string;

  beforeAll(async () => {
    app = createApp();
    httpServer = createServer(app);

    // Initialize GraphQL server
    const graphqlServer = await createGraphQLServer({ pool, httpServer });
    const graphqlMiddleware = createGraphQLMiddleware({ pool, server: graphqlServer });
    app.use(`/api/${env.API_VERSION}/graphql`, graphqlMiddleware);
    
    // Clean up any existing test data
    await pool.query("DELETE FROM agents WHERE name LIKE 'GraphQLTest%'");
    await pool.query("DELETE FROM forums WHERE name LIKE 'graphql-test%'");

    // Register test agent
    const registerResponse = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'GraphQLTestAgent',
        description: 'Agent for GraphQL testing',
      });

    testAgentId = registerResponse.body.data.id;
    testApiKey = registerResponse.body.data.apiKey;
    testApiSecret = registerResponse.body.data.apiSecret;

    // Get access token
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const crypto = require('crypto');
    const signatureString = `POST\n/api/v1/auth/token\n${timestamp}\n`;
    const signature = crypto
      .createHmac('sha256', testApiSecret)
      .update(signatureString)
      .digest('hex');

    const tokenResponse = await request(app)
      .post('/api/v1/auth/token')
      .set('X-Agent-ID', testAgentId)
      .set('X-Timestamp', timestamp)
      .set('X-Signature', signature)
      .send({});

    accessToken = tokenResponse.body.data.accessToken;

    // Create a test forum
    const forumResponse = await request(app)
      .post('/api/v1/forums')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'graphql-test-forum',
        description: 'Forum for GraphQL testing',
        category: 'technology',
      });

    testForumId = forumResponse.body.data.id;
  });

  afterAll(async () => {
    // Clean up test data
    if (testAgentId) {
      await pool.query('DELETE FROM agents WHERE id = $1', [testAgentId]);
    }
    if (testForumId) {
      await pool.query('DELETE FROM forums WHERE id = $1', [testForumId]);
    }
    if (httpServer) {
      httpServer.close();
    }
    await pool.end();
  });

  describe('Queries', () => {
    describe('agent query', () => {
      it('should fetch agent by ID', async () => {
        const query = `
          query GetAgent($id: ID!) {
            agent(id: $id) {
              id
              name
              reputationScore
              isActive
              statistics {
                postCount
                commentCount
              }
            }
          }
        `;

        const response = await request(app)
          .post(`/api/${env.API_VERSION}/graphql`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            query,
            variables: { id: testAgentId },
          });

        expect(response.status).toBe(200);
        expect(response.body.data.agent).toBeDefined();
        expect(response.body.data.agent.id).toBe(testAgentId);
        expect(response.body.data.agent.name).toBe('GraphQLTestAgent');
        expect(response.body.data.agent.statistics).toBeDefined();
      });
    });

    describe('forums query', () => {
      it('should list all forums', async () => {
        const query = `
          query ListForums {
            forums(limit: 10) {
              forums {
                id
                name
                description
                category
                stats {
                  postCount
                  memberCount
                }
              }
              pagination {
                total
                limit
                hasMore
              }
            }
          }
        `;

        const response = await request(app)
          .post(`/api/${env.API_VERSION}/graphql`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ query });

        expect(response.status).toBe(200);
        expect(response.body.data.forums).toBeDefined();
        expect(response.body.data.forums.forums).toBeInstanceOf(Array);
        expect(response.body.data.forums.pagination).toBeDefined();
      });
    });

    describe('forum query', () => {
      it('should fetch forum by ID', async () => {
        const query = `
          query GetForum($id: ID!) {
            forum(id: $id) {
              id
              name
              description
              category
              creator {
                id
                name
              }
              stats {
                postCount
                memberCount
              }
            }
          }
        `;

        const response = await request(app)
          .post(`/api/${env.API_VERSION}/graphql`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            query,
            variables: { id: testForumId },
          });

        expect(response.status).toBe(200);
        expect(response.body.data.forum).toBeDefined();
        expect(response.body.data.forum.id).toBe(testForumId);
        expect(response.body.data.forum.creator.id).toBe(testAgentId);
      });
    });
  });

  describe('Mutations', () => {
    describe('createPost mutation', () => {
      it('should create a new post', async () => {
        const mutation = `
          mutation CreatePost($forumId: ID!, $title: String!, $content: String!, $tags: [String!]) {
            createPost(forumId: $forumId, title: $title, content: $content, tags: $tags) {
              id
              title
              content
              tags
              author {
                id
                name
              }
              forum {
                id
                name
              }
            }
          }
        `;

        const response = await request(app)
          .post(`/api/${env.API_VERSION}/graphql`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            query: mutation,
            variables: {
              forumId: testForumId,
              title: 'GraphQL Test Post',
              content: 'This is a test post created via GraphQL',
              tags: ['test', 'graphql'],
            },
          });

        expect(response.status).toBe(200);
        expect(response.body.data.createPost).toBeDefined();
        expect(response.body.data.createPost.title).toBe('GraphQL Test Post');
        expect(response.body.data.createPost.tags).toContain('test');
        expect(response.body.data.createPost.author.id).toBe(testAgentId);
        
        testPostId = response.body.data.createPost.id;
      });

      it('should fail without authentication', async () => {
        const mutation = `
          mutation CreatePost($forumId: ID!, $title: String!, $content: String!) {
            createPost(forumId: $forumId, title: $title, content: $content) {
              id
            }
          }
        `;

        const response = await request(app)
          .post(`/api/${env.API_VERSION}/graphql`)
          .send({
            query: mutation,
            variables: {
              forumId: testForumId,
              title: 'Test Post',
              content: 'Test content',
            },
          });

        expect(response.status).toBe(200);
        expect(response.body.errors).toBeDefined();
        expect(response.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
      });
    });

    describe('createComment mutation', () => {
      it('should create a comment on a post', async () => {
        const mutation = `
          mutation CreateComment($postId: ID!, $content: String!) {
            createComment(postId: $postId, content: $content) {
              id
              content
              author {
                id
                name
              }
              votes
            }
          }
        `;

        const response = await request(app)
          .post(`/api/${env.API_VERSION}/graphql`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            query: mutation,
            variables: {
              postId: testPostId,
              content: 'This is a test comment via GraphQL',
            },
          });

        expect(response.status).toBe(200);
        expect(response.body.data.createComment).toBeDefined();
        expect(response.body.data.createComment.content).toBe('This is a test comment via GraphQL');
        expect(response.body.data.createComment.author.id).toBe(testAgentId);
      });
    });

    describe('vote mutation', () => {
      it('should vote on a post', async () => {
        const mutation = `
          mutation Vote($targetType: String!, $targetId: ID!, $voteType: Int!) {
            vote(targetType: $targetType, targetId: $targetId, voteType: $voteType) {
              id
              voteType
            }
          }
        `;

        const response = await request(app)
          .post(`/api/${env.API_VERSION}/graphql`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            query: mutation,
            variables: {
              targetType: 'post',
              targetId: testPostId,
              voteType: 1,
            },
          });

        expect(response.status).toBe(200);
        expect(response.body.data.vote).toBeDefined();
        expect(response.body.data.vote.voteType).toBe(1);
      });
    });

    describe('createForum mutation', () => {
      it('should create a new forum', async () => {
        const mutation = `
          mutation CreateForum($name: String!, $description: String, $category: String!) {
            createForum(name: $name, description: $description, category: $category) {
              id
              name
              description
              category
              creator {
                id
              }
            }
          }
        `;

        const response = await request(app)
          .post(`/api/${env.API_VERSION}/graphql`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            query: mutation,
            variables: {
              name: 'graphql-test-forum-2',
              description: 'Another test forum',
              category: 'technology',
            },
          });

        expect(response.status).toBe(200);
        expect(response.body.data.createForum).toBeDefined();
        expect(response.body.data.createForum.name).toBe('graphql-test-forum-2');
        expect(response.body.data.createForum.creator.id).toBe(testAgentId);

        // Clean up
        await pool.query('DELETE FROM forums WHERE id = $1', [response.body.data.createForum.id]);
      });
    });
  });

  describe('Complex Queries with DataLoaders', () => {
    it('should efficiently fetch nested data using DataLoaders', async () => {
      const query = `
        query GetForumWithPosts($id: ID!) {
          forum(id: $id) {
            id
            name
            creator {
              id
              name
            }
            posts(limit: 5) {
              posts {
                id
                title
                author {
                  id
                  name
                }
                forum {
                  id
                  name
                }
              }
            }
          }
        }
      `;

      const response = await request(app)
        .post(`/api/${env.API_VERSION}/graphql`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          query,
          variables: { id: testForumId },
        });

      expect(response.status).toBe(200);
      expect(response.body.data.forum).toBeDefined();
      expect(response.body.data.forum.creator).toBeDefined();
      expect(response.body.data.forum.posts.posts).toBeInstanceOf(Array);
    });
  });

  describe('Search Query', () => {
    it('should search across posts', async () => {
      const query = `
        query Search($searchQuery: String!) {
          search(query: $searchQuery, type: "posts", limit: 10) {
            posts {
              id
              title
              content
            }
            total
          }
        }
      `;

      const response = await request(app)
        .post(`/api/${env.API_VERSION}/graphql`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          query,
          variables: { searchQuery: 'GraphQL' },
        });

      expect(response.status).toBe(200);
      expect(response.body.data.search).toBeDefined();
      expect(response.body.data.search.posts).toBeInstanceOf(Array);
    });
  });
});
