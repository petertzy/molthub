import { Pool } from 'pg';
import { ForumService, CreateForumData, UpdateForumData } from '@modules/forums/forum.service';
import { cacheService, CacheKeys, CacheTTL } from '@shared/cache';
import { NotFoundError, ForbiddenError, ValidationError } from '@shared/middleware/error.middleware';

// Mock dependencies
jest.mock('@config/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@shared/cache', () => ({
  cacheService: {
    initialize: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    invalidateForum: jest.fn(),
    invalidateTrending: jest.fn(),
    getTrendingForums: jest.fn(),
    setTrendingForums: jest.fn(),
    getHotPosts: jest.fn(),
    setHotPosts: jest.fn(),
  },
  CacheKeys: {
    FORUM_DETAIL: (id: string) => `forum:${id}:detail`,
  },
  CacheTTL: {
    MEDIUM: 3600,
  },
}));

describe('ForumService', () => {
  let service: ForumService;
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn(),
      release: jest.fn(),
    };

    service = new ForumService(mockPool as Pool);
    jest.clearAllMocks();
  });

  describe('createForum', () => {
    const creatorId = 'agent-123';
    const forumData: CreateForumData = {
      name: 'Test Forum',
      description: 'A test forum',
      category: 'technology',
    };

    it('should create a forum successfully', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          id: 'forum-123',
          name: forumData.name,
          slug: 'test-forum',
          description: forumData.description,
          creator_id: creatorId,
          category: forumData.category,
          created_at: new Date(),
          rules: {},
        }],
        rowCount: 1,
      });

      const result = await service.createForum(creatorId, forumData);

      expect(result.id).toBe('forum-123');
      expect(result.name).toBe(forumData.name);
      expect(result.slug).toBe('test-forum');
      expect(cacheService.invalidateTrending).toHaveBeenCalled();
    });

    it('should generate slug from name', async () => {
      const nameWithSpaces = 'My New Forum Name';
      mockPool.query.mockResolvedValue({
        rows: [{
          id: 'forum-123',
          name: nameWithSpaces,
          slug: 'my-new-forum-name',
          description: 'Test',
          creator_id: creatorId,
          category: 'general',
          created_at: new Date(),
          rules: {},
        }],
        rowCount: 1,
      });

      const result = await service.createForum(creatorId, { name: nameWithSpaces });

      expect(result.slug).toBe('my-new-forum-name');
    });

    it('should throw ValidationError for invalid name length', async () => {
      await expect(service.createForum(creatorId, { name: 'ab' })).rejects.toThrow(ValidationError);
      await expect(service.createForum(creatorId, { name: 'a'.repeat(256) })).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid description length', async () => {
      await expect(service.createForum(creatorId, {
        name: 'Valid Name',
        description: 'a'.repeat(1001),
      })).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when name already exists', async () => {
      mockPool.query.mockRejectedValue({ code: '23505' });

      await expect(service.createForum(creatorId, forumData)).rejects.toThrow(ValidationError);
    });

    it('should handle database errors', async () => {
      mockPool.query.mockRejectedValue(new Error('Database error'));

      await expect(service.createForum(creatorId, forumData)).rejects.toThrow('Database error');
    });
  });

  describe('listForums', () => {
    it('should return cached trending forums', async () => {
      const cachedForums = [
        {
          id: 'forum-1',
          name: 'Forum 1',
          slug: 'forum-1',
          description: 'Test',
          category: 'general',
          creator: { id: 'agent-1', name: 'Agent 1' },
          stats: { postCount: 10, memberCount: 5, activeToday: 0 },
          createdAt: new Date(),
          isArchived: false,
        },
      ];

      (cacheService.getTrendingForums as jest.Mock).mockResolvedValue(cachedForums);

      const result = await service.listForums({ sort: 'trending' });

      expect(result.forums).toEqual(cachedForums);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should query database and cache trending forums when not cached', async () => {
      (cacheService.getTrendingForums as jest.Mock).mockResolvedValue(null);

      mockPool.query
        .mockResolvedValueOnce({ // Forums query
          rows: [{
            id: 'forum-1',
            name: 'Forum 1',
            slug: 'forum-1',
            description: 'Test',
            category: 'general',
            created_at: new Date(),
            post_count: 10,
            member_count: 5,
            is_archived: false,
            creator_id: 'agent-1',
            creator_name: 'Agent 1',
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Count query
          rows: [{ total: '1' }],
          rowCount: 1,
        });

      const result = await service.listForums({ sort: 'trending' });

      expect(result.forums).toHaveLength(1);
      expect(cacheService.setTrendingForums).toHaveBeenCalled();
    });

    it('should support filtering by category', async () => {
      (cacheService.getTrendingForums as jest.Mock).mockResolvedValue(null);

      mockPool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      await service.listForums({ category: 'technology', sort: 'trending' });

      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should support search filter', async () => {
      (cacheService.getTrendingForums as jest.Mock).mockResolvedValue(null);

      mockPool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      await service.listForums({ search: 'test', sort: 'trending' });

      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should support different sort options', async () => {
      (cacheService.getTrendingForums as jest.Mock).mockResolvedValue(null);

      mockPool.query
        .mockResolvedValue({ rows: [], rowCount: 0 })
        .mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await service.listForums({ sort: 'newest' });
      await service.listForums({ sort: 'active' });
      await service.listForums({ sort: 'members' });

      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should throw ValidationError for invalid pagination', async () => {
      (cacheService.getTrendingForums as jest.Mock).mockResolvedValue(null);

      await expect(service.listForums({ limit: 0 })).rejects.toThrow(ValidationError);
      await expect(service.listForums({ limit: 101 })).rejects.toThrow(ValidationError);
      await expect(service.listForums({ offset: -1 })).rejects.toThrow(ValidationError);
    });
  });

  describe('getForumById', () => {
    const forumId = 'forum-123';

    it('should return cached forum if available', async () => {
      const cachedForum = {
        id: forumId,
        name: 'Test Forum',
        slug: 'test-forum',
        description: 'Test',
        category: 'general',
        creator: { id: 'agent-1', name: 'Agent 1' },
        rules: {},
        stats: { postCount: 10, memberCount: 5, activeToday: 0 },
        visibility: 'public',
        createdAt: new Date(),
        updatedAt: new Date(),
        isArchived: false,
      };

      (cacheService.get as jest.Mock).mockResolvedValue(cachedForum);

      const result = await service.getForumById(forumId);

      expect(result).toEqual(cachedForum);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should query database and cache result when not cached', async () => {
      (cacheService.get as jest.Mock).mockResolvedValue(null);

      mockPool.query.mockResolvedValue({
        rows: [{
          id: forumId,
          name: 'Test Forum',
          slug: 'test-forum',
          description: 'Test',
          category: 'general',
          created_at: new Date(),
          updated_at: new Date(),
          rules: {},
          post_count: 10,
          member_count: 5,
          is_archived: false,
          visibility: 'public',
          creator_id: 'agent-1',
          creator_name: 'Agent 1',
        }],
        rowCount: 1,
      });

      const result = await service.getForumById(forumId);

      expect(result.id).toBe(forumId);
      expect(cacheService.set).toHaveBeenCalled();
    });

    it('should throw NotFoundError when forum does not exist', async () => {
      (cacheService.get as jest.Mock).mockResolvedValue(null);
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(service.getForumById(forumId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateForum', () => {
    const forumId = 'forum-123';
    const agentId = 'agent-123';
    const updateData: UpdateForumData = {
      description: 'Updated description',
      rules: { rule1: 'No spam' },
    };

    it('should update forum successfully', async () => {
      (cacheService.get as jest.Mock).mockResolvedValue({
        id: forumId,
        creator: { id: agentId },
      });

      mockPool.query.mockResolvedValue({
        rows: [{
          id: forumId,
          name: 'Test Forum',
          slug: 'test-forum',
          description: updateData.description,
          rules: updateData.rules,
          updated_at: new Date(),
        }],
        rowCount: 1,
      });

      const result = await service.updateForum(forumId, agentId, updateData);

      expect(result.description).toBe(updateData.description);
      expect(cacheService.invalidateForum).toHaveBeenCalledWith(forumId);
    });

    it('should throw ForbiddenError when agent is not the creator', async () => {
      (cacheService.get as jest.Mock).mockResolvedValue({
        id: forumId,
        creator: { id: 'different-agent' },
      });

      await expect(service.updateForum(forumId, agentId, updateData)).rejects.toThrow(ForbiddenError);
    });

    it('should throw ValidationError for invalid description length', async () => {
      (cacheService.get as jest.Mock).mockResolvedValue({
        id: forumId,
        creator: { id: agentId },
      });

      await expect(service.updateForum(forumId, agentId, {
        description: 'a'.repeat(1001),
      })).rejects.toThrow(ValidationError);
    });

    it('should return existing forum when no updates to make', async () => {
      const forum = {
        id: forumId,
        name: 'Test Forum',
        creator: { id: agentId },
      };

      (cacheService.get as jest.Mock).mockResolvedValue(forum);

      const result = await service.updateForum(forumId, agentId, {});

      expect(result).toEqual(forum);
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('deleteForum', () => {
    const forumId = 'forum-123';
    const agentId = 'agent-123';

    it('should delete forum successfully', async () => {
      (cacheService.get as jest.Mock).mockResolvedValue({
        id: forumId,
        creator: { id: agentId },
      });

      mockPool.query.mockResolvedValue({ rowCount: 1 });

      const result = await service.deleteForum(forumId, agentId);

      expect(result.success).toBe(true);
      expect(cacheService.invalidateForum).toHaveBeenCalledWith(forumId);
      expect(cacheService.invalidateTrending).toHaveBeenCalled();
    });

    it('should throw ForbiddenError when agent is not the creator', async () => {
      (cacheService.get as jest.Mock).mockResolvedValue({
        id: forumId,
        creator: { id: 'different-agent' },
      });

      await expect(service.deleteForum(forumId, agentId)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getForumPosts', () => {
    const forumId = 'forum-123';

    beforeEach(() => {
      (cacheService.get as jest.Mock).mockResolvedValue({
        id: forumId,
        name: 'Test Forum',
      });
    });

    it('should return cached hot posts', async () => {
      const cachedPosts = [{
        id: 'post-1',
        title: 'Test Post',
        content: 'Content',
        author: { id: 'agent-1', name: 'Agent 1' },
        createdAt: new Date(),
        updatedAt: new Date(),
        stats: { votes: 10, comments: 5, views: 100 },
        tags: [],
        isPinned: false,
        isLocked: false,
      }];

      (cacheService.getHotPosts as jest.Mock).mockResolvedValue(cachedPosts);

      const result = await service.getForumPosts(forumId, { sort: 'hot' });

      expect(result.posts).toEqual(cachedPosts);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should query database and cache hot posts when not cached', async () => {
      (cacheService.getHotPosts as jest.Mock).mockResolvedValue(null);

      mockPool.query
        .mockResolvedValueOnce({ // Posts query
          rows: [{
            id: 'post-1',
            title: 'Test Post',
            content: 'Test content here',
            created_at: new Date(),
            updated_at: new Date(),
            vote_count: 10,
            comment_count: 5,
            view_count: 100,
            tags: [],
            is_pinned: false,
            is_locked: false,
            author_id: 'agent-1',
            author_name: 'Agent 1',
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Count query
          rows: [{ total: '1' }],
          rowCount: 1,
        });

      const result = await service.getForumPosts(forumId, { sort: 'hot' });

      expect(result.posts).toHaveLength(1);
      expect(cacheService.setHotPosts).toHaveBeenCalled();
    });

    it('should support different sort options', async () => {
      (cacheService.getHotPosts as jest.Mock).mockResolvedValue(null);

      // Mock for newest
      mockPool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      await service.getForumPosts(forumId, { sort: 'newest' });

      // Mock for top-week
      mockPool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      await service.getForumPosts(forumId, { sort: 'top-week' });

      // Mock for top-month
      mockPool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      await service.getForumPosts(forumId, { sort: 'top-month' });

      // Mock for top-all
      mockPool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      await service.getForumPosts(forumId, { sort: 'top-all' });

      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should support tags filter', async () => {
      (cacheService.getHotPosts as jest.Mock).mockResolvedValue(null);

      mockPool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      await service.getForumPosts(forumId, { tags: ['javascript', 'testing'] });

      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should throw ValidationError for invalid pagination', async () => {
      await expect(service.getForumPosts(forumId, { limit: 0 })).rejects.toThrow(ValidationError);
      await expect(service.getForumPosts(forumId, { limit: 101 })).rejects.toThrow(ValidationError);
    });
  });
});
