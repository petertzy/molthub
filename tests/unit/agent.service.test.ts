import { Pool } from 'pg';
import { AgentService, AgentProfile, AgentStats } from '@modules/agents/agent.service';
import { cacheService, CacheKeys, CacheTTL } from '@shared/cache';
import { NotFoundError } from '@shared/middleware/error.middleware';

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
    invalidateAgent: jest.fn(),
    getAgentStats: jest.fn(),
    setAgentStats: jest.fn(),
  },
  CacheKeys: {
    AGENT_PROFILE: (id: string) => `agent:${id}:profile`,
    AGENT_STATS: (id: string) => `agent:${id}:stats`,
  },
  CacheTTL: {
    MEDIUM: 3600,
  },
}));

describe('AgentService', () => {
  let service: AgentService;
  let mockPool: any;

  beforeEach(() => {
    // Create mock pool
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn(),
      release: jest.fn(),
    };

    service = new AgentService(mockPool as Pool);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('getAgentProfile', () => {
    const mockAgentId = 'agent-123';
    const mockProfile: AgentProfile = {
      id: mockAgentId,
      name: 'TestAgent',
      createdAt: new Date('2024-01-01'),
      lastActive: new Date('2024-02-01'),
      reputationScore: 100,
      isActive: true,
      statistics: {
        postCount: 10,
        commentCount: 20,
        upvoteReceived: 50,
        downvoteReceived: 5,
        subscriptionCount: 15,
      },
      topForums: ['forum-1', 'forum-2'],
      metadata: {},
    };

    it('should return cached profile if available', async () => {
      (cacheService.get as jest.Mock).mockResolvedValue(mockProfile);

      const result = await service.getAgentProfile(mockAgentId);

      expect(result).toEqual(mockProfile);
      expect(cacheService.get).toHaveBeenCalledWith(CacheKeys.AGENT_PROFILE(mockAgentId));
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should query database and cache result when not cached', async () => {
      (cacheService.get as jest.Mock).mockResolvedValue(null);
      mockPool.query.mockResolvedValue({
        rows: [{
          id: mockAgentId,
          name: 'TestAgent',
          created_at: '2024-01-01',
          last_active: '2024-02-01',
          reputation_score: 100,
          is_active: true,
          metadata: {},
          post_count: '10',
          comment_count: '20',
          upvote_received: '50',
          downvote_received: '5',
          subscription_count: '15',
          top_forums: ['forum-1', 'forum-2'],
        }],
        rowCount: 1,
      } as any);

      const result = await service.getAgentProfile(mockAgentId);

      expect(result.id).toBe(mockAgentId);
      expect(result.name).toBe('TestAgent');
      expect(result.statistics.postCount).toBe(10);
      expect(mockPool.query).toHaveBeenCalled();
      expect(cacheService.set).toHaveBeenCalled();
    });

    it('should throw NotFoundError when agent does not exist', async () => {
      (cacheService.get as jest.Mock).mockResolvedValue(null);
      mockPool.query.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as any);

      await expect(service.getAgentProfile(mockAgentId)).rejects.toThrow(NotFoundError);
    });

    it('should handle database errors', async () => {
      (cacheService.get as jest.Mock).mockResolvedValue(null);
      mockPool.query.mockRejectedValue(new Error('Database error'));

      await expect(service.getAgentProfile(mockAgentId)).rejects.toThrow('Database error');
    });
  });

  describe('getAgentStats', () => {
    const mockAgentId = 'agent-123';
    const mockStats: AgentStats = {
      reputationScore: 100,
      postsCreated: 10,
      commentsCreated: 20,
      upvotesReceived: 50,
      downvotesReceived: 5,
      averageCommentPerPost: 2.0,
      joined: new Date('2024-01-01'),
      activity7Days: {
        posts: 3,
        comments: 5,
        votes: 8,
      },
    };

    it('should return cached stats if available', async () => {
      (cacheService.getAgentStats as jest.Mock).mockResolvedValue(mockStats);

      const result = await service.getAgentStats(mockAgentId);

      expect(result).toEqual(mockStats);
      expect(cacheService.getAgentStats).toHaveBeenCalledWith(mockAgentId);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should query database and cache result when not cached', async () => {
      (cacheService.getAgentStats as jest.Mock).mockResolvedValue(null);
      
      // Mock agent query
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ id: mockAgentId, created_at: '2024-01-01', reputation_score: 100 }],
          rowCount: 1,
        } as any)
        // Mock stats query
        .mockResolvedValueOnce({
          rows: [{
            posts_created: '10',
            comments_created: '20',
            upvotes_received: '50',
            downvotes_received: '5',
          }],
          rowCount: 1,
        } as any)
        // Mock 7-day activity query
        .mockResolvedValueOnce({
          rows: [{
            posts: '3',
            comments: '5',
            votes: '8',
          }],
          rowCount: 1,
        } as any);

      const result = await service.getAgentStats(mockAgentId);

      expect(result.reputationScore).toBe(100);
      expect(result.postsCreated).toBe(10);
      expect(result.activity7Days.posts).toBe(3);
      expect(mockPool.query).toHaveBeenCalledTimes(3);
      expect(cacheService.setAgentStats).toHaveBeenCalled();
    });

    it('should throw NotFoundError when agent does not exist', async () => {
      (cacheService.getAgentStats as jest.Mock).mockResolvedValue(null);
      mockPool.query.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as any);

      await expect(service.getAgentStats(mockAgentId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('getAgentPosts', () => {
    const mockAgentId = 'agent-123';

    it('should return paginated posts for an agent', async () => {
      // Mock agent check query
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ id: mockAgentId }],
          rowCount: 1,
        } as any)
        // Mock total count query
        .mockResolvedValueOnce({
          rows: [{ total: '25' }],
          rowCount: 1,
        } as any)
        // Mock posts query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'post-1',
              forum_id: 'forum-1',
              forum_name: 'Test Forum',
              title: 'Test Post 1',
              content: 'Content 1',
              created_at: '2024-01-01',
              vote_count: 10,
              comment_count: 5,
            },
            {
              id: 'post-2',
              forum_id: 'forum-1',
              forum_name: 'Test Forum',
              title: 'Test Post 2',
              content: 'Content 2',
              created_at: '2024-01-02',
              vote_count: 15,
              comment_count: 8,
            },
          ],
          rowCount: 2,
        } as any);

      const result = await service.getAgentPosts(mockAgentId, 10, 0);

      expect(result.posts).toHaveLength(2);
      expect(result.posts[0].title).toBe('Test Post 1');
      expect(result.pagination.total).toBe(25);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.hasMore).toBe(true);
    });

    it('should throw NotFoundError when agent does not exist', async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as any);

      await expect(service.getAgentPosts(mockAgentId, 10, 0)).rejects.toThrow(NotFoundError);
    });

    it('should handle empty posts list', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ id: mockAgentId }],
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [{ total: '0' }],
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
        } as any);

      const result = await service.getAgentPosts(mockAgentId, 10, 0);

      expect(result.posts).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.hasMore).toBe(false);
    });
  });

  describe('invalidateAgentCache', () => {
    it('should call cache invalidation for agent', async () => {
      const mockAgentId = 'agent-123';

      await service.invalidateAgentCache(mockAgentId);

      expect(cacheService.invalidateAgent).toHaveBeenCalledWith(mockAgentId);
    });
  });

  describe('cleanup', () => {
    it('should be a no-op (backwards compatibility)', async () => {
      await service.cleanup();
      
      // cleanup is now a no-op, so pool.end should not be called
      expect(mockPool.end).not.toHaveBeenCalled();
    });
  });
});
