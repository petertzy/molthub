import { Pool } from 'pg';
import { PostService, CreatePostData, UpdatePostData } from '@modules/posts/post.service';
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
    invalidatePost: jest.fn(),
    invalidateForum: jest.fn(),
    invalidateTrending: jest.fn(),
  },
  CacheKeys: {
    POST_DETAIL: (id: string) => `post:${id}:detail`,
  },
  CacheTTL: {
    MEDIUM: 3600,
  },
}));

describe('PostService', () => {
  let service: PostService;
  let mockPool: any;
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };

    mockPool = {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue(mockClient),
      end: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn(),
      release: jest.fn(),
    };

    service = new PostService(mockPool as Pool);
    jest.clearAllMocks();
  });

  describe('createPost', () => {
    const forumId = 'forum-123';
    const authorId = 'agent-123';
    const postData: CreatePostData = {
      title: 'Test Post Title',
      content: 'Test post content that is long enough',
      tags: ['javascript', 'testing'],
    };

    it('should create a post successfully', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Forum check
          rows: [{ id: forumId, is_archived: false }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Insert post
          rows: [{
            id: 'post-123',
            forum_id: forumId,
            author_id: authorId,
            title: postData.title,
            content: postData.content,
            tags: postData.tags,
            attachments: [],
            created_at: new Date(),
            updated_at: new Date(),
            vote_count: 0,
            comment_count: 0,
            view_count: 0,
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }) // Update forum post count
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      const result = await service.createPost(forumId, authorId, postData);

      expect(result.id).toBe('post-123');
      expect(result.title).toBe(postData.title);
      expect(cacheService.invalidateForum).toHaveBeenCalledWith(forumId);
      expect(cacheService.invalidateTrending).toHaveBeenCalled();
    });

    it('should throw ValidationError for invalid title length', async () => {
      await expect(service.createPost(forumId, authorId, { ...postData, title: 'Short' })).rejects.toThrow(ValidationError);
      await expect(service.createPost(forumId, authorId, { ...postData, title: 'a'.repeat(501) })).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid content length', async () => {
      await expect(service.createPost(forumId, authorId, { ...postData, content: '' })).rejects.toThrow(ValidationError);
      await expect(service.createPost(forumId, authorId, { ...postData, content: 'a'.repeat(50001) })).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for too many tags', async () => {
      await expect(service.createPost(forumId, authorId, {
        ...postData,
        tags: Array(11).fill('tag'),
      })).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for too many attachments', async () => {
      await expect(service.createPost(forumId, authorId, {
        ...postData,
        attachments: Array(6).fill({ url: 'test' }),
      })).rejects.toThrow(ValidationError);
    });

    it('should throw NotFoundError when forum does not exist', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // Forum check

      await expect(service.createPost(forumId, authorId, postData)).rejects.toThrow(NotFoundError);
    });

    it('should throw ForbiddenError when forum is archived', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Forum check
          rows: [{ id: forumId, is_archived: true }],
          rowCount: 1,
        });

      await expect(service.createPost(forumId, authorId, postData)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('listPosts', () => {
    it('should list posts with pagination', async () => {
      mockPool.query
        .mockResolvedValueOnce({ // Count
          rows: [{ count: '2' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Posts
          rows: [
            {
              id: 'post-1',
              forum_id: 'forum-1',
              forum_name: 'Forum 1',
              forum_slug: 'forum-1',
              author_id: 'agent-1',
              author_name: 'Agent 1',
              author_reputation: 100,
              title: 'Post 1',
              content: 'Content 1',
              tags: ['tag1'],
              attachments: [],
              created_at: new Date(),
              updated_at: new Date(),
              vote_count: 5,
              comment_count: 3,
              view_count: 50,
              is_pinned: false,
              is_locked: false,
            },
          ],
          rowCount: 1,
        });

      const result = await service.listPosts({});

      expect(result.posts).toHaveLength(1);
      expect(result.pagination.total).toBe(2);
    });

    it('should support filtering by forumId', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.listPosts({ forumId: 'forum-123' });

      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should support filtering by authorId', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.listPosts({ authorId: 'agent-123' });

      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should support filtering by tags', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.listPosts({ tags: ['javascript', 'testing'] });

      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should support different sort options', async () => {
      // Mock for hot
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.listPosts({ sort: 'hot' });

      // Mock for newest
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.listPosts({ sort: 'newest' });

      // Mock for top-week
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.listPosts({ sort: 'top-week' });

      // Mock for top-month
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.listPosts({ sort: 'top-month' });

      // Mock for top-all
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.listPosts({ sort: 'top-all' });

      expect(mockPool.query).toHaveBeenCalled();
    });
  });

  describe('getPostById', () => {
    const postId = 'post-123';

    it('should return cached post if available', async () => {
      const cachedPost = {
        id: postId,
        forum: { id: 'forum-1', name: 'Forum 1', slug: 'forum-1' },
        author: { id: 'agent-1', name: 'Agent 1', reputationScore: 100 },
        title: 'Test Post',
        content: 'Test content',
        tags: [],
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        stats: { votes: 0, comments: 0, views: 0 },
        userVote: null,
        isPinned: false,
        isLocked: false,
      };

      (cacheService.get as jest.Mock).mockResolvedValue(cachedPost);
      
      // Mock the view count update query
      mockPool.query.mockResolvedValue({ rowCount: 1 });

      const result = await service.getPostById(postId);

      expect(result).toEqual(cachedPost);
      expect(mockPool.query).toHaveBeenCalledWith(
        'UPDATE posts SET view_count = view_count + 1 WHERE id = $1',
        [postId]
      );
    });

    it('should query database and cache result when not cached', async () => {
      (cacheService.get as jest.Mock).mockResolvedValue(null);

      mockPool.query.mockResolvedValue({
        rows: [{
          id: postId,
          forum_id: 'forum-1',
          forum_name: 'Forum 1',
          forum_slug: 'forum-1',
          author_id: 'agent-1',
          author_name: 'Agent 1',
          author_reputation: 100,
          title: 'Test Post',
          content: 'Test content',
          tags: [],
          attachments: [],
          created_at: new Date(),
          updated_at: new Date(),
          vote_count: 0,
          comment_count: 0,
          view_count: 0,
          user_vote: null,
          is_pinned: false,
          is_locked: false,
        }],
        rowCount: 1,
      });

      const result = await service.getPostById(postId);

      expect(result.id).toBe(postId);
      expect(cacheService.set).toHaveBeenCalled();
    });

    it('should throw NotFoundError when post does not exist', async () => {
      (cacheService.get as jest.Mock).mockResolvedValue(null);
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(service.getPostById(postId)).rejects.toThrow(NotFoundError);
    });

    it('should include user vote when viewerId is provided', async () => {
      (cacheService.get as jest.Mock).mockResolvedValue(null);

      mockPool.query.mockResolvedValue({
        rows: [{
          id: postId,
          forum_id: 'forum-1',
          forum_name: 'Forum 1',
          forum_slug: 'forum-1',
          author_id: 'agent-1',
          author_name: 'Agent 1',
          author_reputation: 100,
          title: 'Test Post',
          content: 'Test content',
          tags: [],
          attachments: [],
          created_at: new Date(),
          updated_at: new Date(),
          vote_count: 0,
          comment_count: 0,
          view_count: 0,
          user_vote: 1,
          is_pinned: false,
          is_locked: false,
        }],
        rowCount: 1,
      });

      const result = await service.getPostById(postId, 'agent-123');

      expect(result.userVote).toBe(1);
    });
  });

  describe('updatePost', () => {
    const postId = 'post-123';
    const editorId = 'agent-123';
    const updateData: UpdatePostData = {
      title: 'Updated Title Here',
      content: 'Updated content',
      editReason: 'Fixed typo',
    };

    it('should update a post successfully', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Get current post
          rows: [{
            id: postId,
            author_id: editorId,
            title: 'Old Title',
            content: 'Old content',
            tags: [],
            forum_id: 'forum-123',
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }) // Insert edit history
        .mockResolvedValueOnce({ // Update post
          rows: [{
            id: postId,
            forum_id: 'forum-123',
            author_id: editorId,
            title: updateData.title,
            content: updateData.content,
            tags: [],
            attachments: [],
            created_at: new Date(),
            updated_at: new Date(),
            vote_count: 5,
            comment_count: 3,
            view_count: 50,
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      const result = await service.updatePost(postId, editorId, updateData);

      expect(result.title).toBe(updateData.title);
      expect(cacheService.invalidatePost).toHaveBeenCalledWith(postId);
    });

    it('should throw ValidationError for invalid title length', async () => {
      await expect(service.updatePost(postId, editorId, { title: 'Short' })).rejects.toThrow(ValidationError);
      await expect(service.updatePost(postId, editorId, { title: 'a'.repeat(501) })).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid content length', async () => {
      await expect(service.updatePost(postId, editorId, { content: '' })).rejects.toThrow(ValidationError);
      await expect(service.updatePost(postId, editorId, { content: 'a'.repeat(50001) })).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for too many tags', async () => {
      await expect(service.updatePost(postId, editorId, {
        tags: Array(11).fill('tag'),
      })).rejects.toThrow(ValidationError);
    });

    it('should throw NotFoundError when post does not exist', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // Get current post

      await expect(service.updatePost(postId, editorId, updateData)).rejects.toThrow(NotFoundError);
    });

    it('should throw ForbiddenError when editor is not the author', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Get current post
          rows: [{
            id: postId,
            author_id: 'different-agent',
            title: 'Old Title',
            content: 'Old content',
            tags: [],
            forum_id: 'forum-123',
          }],
          rowCount: 1,
        });

      await expect(service.updatePost(postId, editorId, updateData)).rejects.toThrow(ForbiddenError);
    });

    it('should throw ValidationError when no fields to update', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Get current post
          rows: [{
            id: postId,
            author_id: editorId,
            title: 'Title',
            content: 'Content',
            tags: [],
            forum_id: 'forum-123',
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // Insert edit history

      await expect(service.updatePost(postId, editorId, {})).rejects.toThrow(ValidationError);
    });
  });

  describe('deletePost', () => {
    const postId = 'post-123';
    const deleterId = 'agent-123';

    it('should delete a post successfully', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Get current post
          rows: [{
            id: postId,
            author_id: deleterId,
            forum_id: 'forum-123',
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }) // Soft delete
        .mockResolvedValueOnce({ rowCount: 1 }) // Update forum post count
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      const result = await service.deletePost(postId, deleterId);

      expect(result.message).toBe('Post deleted successfully');
      expect(cacheService.invalidatePost).toHaveBeenCalledWith(postId);
      expect(cacheService.invalidateForum).toHaveBeenCalledWith('forum-123');
    });

    it('should throw NotFoundError when post does not exist', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // Get current post

      await expect(service.deletePost(postId, deleterId)).rejects.toThrow(NotFoundError);
    });

    it('should throw ForbiddenError when deleter is not the author', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Get current post
          rows: [{
            id: postId,
            author_id: 'different-agent',
            forum_id: 'forum-123',
          }],
          rowCount: 1,
        });

      await expect(service.deletePost(postId, deleterId)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getPostEditHistory', () => {
    const postId = 'post-123';

    it('should return edit history for a post', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: 'edit-1',
            editor_id: 'agent-123',
            editor_name: 'Test Agent',
            previous_title: 'Old Title 1',
            previous_content: 'Old content 1',
            previous_tags: ['tag1'],
            edit_reason: 'Fixed typo',
            created_at: new Date(),
          },
          {
            id: 'edit-2',
            editor_id: 'agent-123',
            editor_name: 'Test Agent',
            previous_title: 'Old Title 2',
            previous_content: 'Old content 2',
            previous_tags: ['tag2'],
            edit_reason: 'Improved clarity',
            created_at: new Date(),
          },
        ],
        rowCount: 2,
      });

      const result = await service.getPostEditHistory(postId);

      expect(result).toHaveLength(2);
      expect(result[0].previousTitle).toBe('Old Title 1');
      expect(result[1].editReason).toBe('Improved clarity');
    });

    it('should return empty array when no edit history exists', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await service.getPostEditHistory(postId);

      expect(result).toHaveLength(0);
    });
  });
});
