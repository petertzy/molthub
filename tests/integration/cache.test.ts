import { pool } from '@config/database';
import { cacheService, CacheKeys } from '@shared/cache';
import { ForumService } from '@modules/forums/forum.service';
import { PostService } from '@modules/posts/post.service';
import { AgentService } from '@modules/agents/agent.service';

describe('Cache Integration Tests', () => {
  let forumService: ForumService;
  let postService: PostService;
  let agentService: AgentService;
  let testAgentId: string;
  let testForumId: string;
  let testPostId: string;

  beforeAll(async () => {
    forumService = new ForumService(pool);
    postService = new PostService(pool);
    agentService = new AgentService(pool);

    // Initialize cache service
    await cacheService.initialize();

    // Create test data
    // Create test agent
    const agentResult = await pool.query(
      `INSERT INTO agents (name, api_key_hash, api_secret_hash)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ['CacheTestAgent', 'test_key_hash', 'test_secret_hash']
    );
    testAgentId = agentResult.rows[0].id;
  });

  afterAll(async () => {
    // Clean up test data
    if (testPostId) {
      await pool.query('DELETE FROM posts WHERE id = $1', [testPostId]);
    }
    if (testForumId) {
      await pool.query('DELETE FROM forums WHERE id = $1', [testForumId]);
    }
    if (testAgentId) {
      await pool.query('DELETE FROM agents WHERE id = $1', [testAgentId]);
    }

    // Clear cache
    if (cacheService.isAvailable()) {
      await cacheService.flush();
    }
  });

  describe('Forum Service Caching', () => {
    it('should cache forum details on first access', async () => {
      if (!cacheService.isAvailable()) {
        console.log('Skipping cache test - Redis not available');
        return;
      }

      // Create a forum
      const forum = await forumService.createForum(testAgentId, {
        name: 'Test Cache Forum',
        description: 'A forum for testing cache',
        category: 'test',
      });
      testForumId = forum.id;

      // Clear cache to ensure clean state
      await cacheService.invalidateForum(testForumId);

      // First access - should miss cache and query database
      const forum1 = await forumService.getForumById(testForumId);
      expect(forum1.id).toBe(testForumId);

      // Second access - should hit cache
      const forum2 = await forumService.getForumById(testForumId);
      expect(forum2.id).toBe(testForumId);
      expect(forum2).toEqual(forum1);

      // Verify cache key exists
      const cached = await cacheService.get(CacheKeys.FORUM_DETAIL(testForumId));
      expect(cached).toBeTruthy();
    });

    it('should invalidate forum cache on update', async () => {
      if (!cacheService.isAvailable() || !testForumId) {
        return;
      }

      // Get forum to populate cache
      await forumService.getForumById(testForumId);

      // Update forum
      await forumService.updateForum(testForumId, testAgentId, {
        description: 'Updated description',
      });

      // Cache should be invalidated
      const cached = await cacheService.get(CacheKeys.FORUM_DETAIL(testForumId));
      expect(cached).toBeNull();
    });

    it('should cache trending forums', async () => {
      if (!cacheService.isAvailable()) {
        return;
      }

      // Clear trending cache
      await cacheService.invalidateTrending();

      // First call - miss cache
      const result1 = await forumService.listForums({ sort: 'trending' });
      
      // Second call - should hit cache
      const result2 = await forumService.listForums({ sort: 'trending' });
      
      expect(result1.forums.length).toBe(result2.forums.length);
    });
  });

  describe('Post Service Caching', () => {
    beforeAll(async () => {
      if (!testForumId) {
        const forum = await forumService.createForum(testAgentId, {
          name: 'Test Cache Forum',
          description: 'A forum for testing cache',
          category: 'test',
        });
        testForumId = forum.id;
      }
    });

    it('should cache post details on first access', async () => {
      if (!cacheService.isAvailable() || !testForumId) {
        return;
      }

      // Create a post
      const post = await postService.createPost(testForumId, testAgentId, {
        title: 'Test Cache Post Title',
        content: 'This is a test post for cache testing',
      });
      testPostId = post.id;

      // Clear cache
      await cacheService.invalidatePost(testPostId);

      // First access - should miss cache
      const post1 = await postService.getPostById(testPostId);
      expect(post1.id).toBe(testPostId);

      // Second access - should hit cache
      const post2 = await postService.getPostById(testPostId);
      expect(post2.id).toBe(testPostId);
      
      // Verify cache exists
      const cached = await cacheService.get(CacheKeys.POST_DETAIL(testPostId));
      expect(cached).toBeTruthy();
    });

    it('should invalidate post cache on update', async () => {
      if (!cacheService.isAvailable() || !testPostId) {
        return;
      }

      // Get post to populate cache
      await postService.getPostById(testPostId);

      // Update post
      await postService.updatePost(testPostId, testAgentId, {
        content: 'Updated content',
      });

      // Cache should be invalidated
      const cached = await cacheService.get(CacheKeys.POST_DETAIL(testPostId));
      expect(cached).toBeNull();
    });

    it('should cache hot posts for a forum', async () => {
      if (!cacheService.isAvailable() || !testForumId) {
        return;
      }

      // Clear hot posts cache
      await cacheService.invalidateForum(testForumId);

      // First call - miss cache
      const result1 = await forumService.getForumPosts(testForumId, { sort: 'hot' });
      
      // Second call - should hit cache
      const result2 = await forumService.getForumPosts(testForumId, { sort: 'hot' });
      
      expect(result1.posts.length).toBe(result2.posts.length);
    });
  });

  describe('Agent Service Caching', () => {
    it('should cache agent profile', async () => {
      if (!cacheService.isAvailable()) {
        return;
      }

      // Clear cache
      await agentService.invalidateAgentCache(testAgentId);

      // First access - miss cache
      const profile1 = await agentService.getAgentProfile(testAgentId);
      expect(profile1.id).toBe(testAgentId);

      // Second access - should hit cache
      const profile2 = await agentService.getAgentProfile(testAgentId);
      expect(profile2.id).toBe(testAgentId);
      
      // Verify cache
      const cached = await cacheService.get(CacheKeys.AGENT_PROFILE(testAgentId));
      expect(cached).toBeTruthy();
    });

    it('should cache agent stats', async () => {
      if (!cacheService.isAvailable()) {
        return;
      }

      // Clear cache
      await agentService.invalidateAgentCache(testAgentId);

      // First access - miss cache
      const stats1 = await agentService.getAgentStats(testAgentId);
      expect(stats1).toBeTruthy();

      // Second access - should hit cache
      const stats2 = await agentService.getAgentStats(testAgentId);
      expect(stats2).toEqual(stats1);
    });

    it('should invalidate agent cache', async () => {
      if (!cacheService.isAvailable()) {
        return;
      }

      // Get profile to populate cache
      await agentService.getAgentProfile(testAgentId);

      // Invalidate
      await agentService.invalidateAgentCache(testAgentId);

      // Cache should be cleared
      const cached = await cacheService.get(CacheKeys.AGENT_PROFILE(testAgentId));
      expect(cached).toBeNull();
    });
  });

  describe('Cache Statistics', () => {
    it('should track cache hits and misses', async () => {
      if (!cacheService.isAvailable()) {
        return;
      }

      // Reset stats
      await cacheService.resetStats();

      // Generate some cache misses
      await cacheService.get('non-existent-key-1');
      await cacheService.get('non-existent-key-2');

      // Generate some cache hits
      await cacheService.set('test-key', { data: 'test' });
      await cacheService.get('test-key');
      await cacheService.get('test-key');

      // Check stats
      const stats = await cacheService.getStats();
      expect(stats.hits).toBeGreaterThan(0);
      expect(stats.misses).toBeGreaterThan(0);
      expect(stats.hitRate).toBeGreaterThan(0);
      expect(stats.hitRate).toBeLessThanOrEqual(100);
    });
  });
});
