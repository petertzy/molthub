import { Pool } from 'pg';
import { CommentService, CreateCommentData, UpdateCommentData } from '@modules/comments/comment.service';
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

describe('CommentService', () => {
  let service: CommentService;
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

    service = new CommentService(mockPool as Pool);
    jest.clearAllMocks();
  });

  describe('createComment', () => {
    const postId = 'post-123';
    const authorId = 'agent-123';
    const commentData: CreateCommentData = {
      content: 'Test comment content',
    };

    it('should create a comment successfully', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Post check
          rows: [{ id: postId, is_locked: false }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Insert comment
          rows: [{
            id: 'comment-123',
            post_id: postId,
            parent_id: null,
            author_id: authorId,
            content: commentData.content,
            created_at: new Date(),
            updated_at: new Date(),
            vote_count: 0,
            reply_count: 0,
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }) // Update post comment count
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      const result = await service.createComment(postId, authorId, commentData);

      expect(result.id).toBe('comment-123');
      expect(result.content).toBe(commentData.content);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should create a reply to a comment', async () => {
      const parentCommentId = 'parent-comment-123';
      const replyData: CreateCommentData = {
        content: 'Test reply',
        parentCommentId,
      };

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Post check
          rows: [{ id: postId, is_locked: false }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Parent comment check
          rows: [{ id: parentCommentId, post_id: postId }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Insert comment
          rows: [{
            id: 'comment-456',
            post_id: postId,
            parent_id: parentCommentId,
            author_id: authorId,
            content: replyData.content,
            created_at: new Date(),
            updated_at: new Date(),
            vote_count: 0,
            reply_count: 0,
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }) // Update post comment count
        .mockResolvedValueOnce({ rowCount: 1 }) // Update parent reply count
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      const result = await service.createComment(postId, authorId, replyData);

      expect(result.parentId).toBe(parentCommentId);
    });

    it('should throw ValidationError for invalid content length', async () => {
      await expect(service.createComment(postId, authorId, { content: '' })).rejects.toThrow(ValidationError);
      await expect(service.createComment(postId, authorId, { content: 'a'.repeat(10001) })).rejects.toThrow(ValidationError);
    });

    it('should throw NotFoundError when post does not exist', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // Post check

      await expect(service.createComment(postId, authorId, commentData)).rejects.toThrow(NotFoundError);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should throw ForbiddenError when post is locked', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Post check
          rows: [{ id: postId, is_locked: true }],
          rowCount: 1,
        });

      await expect(service.createComment(postId, authorId, commentData)).rejects.toThrow(ForbiddenError);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should throw NotFoundError when parent comment does not exist', async () => {
      const replyData: CreateCommentData = {
        content: 'Test reply',
        parentCommentId: 'non-existent',
      };

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Post check
          rows: [{ id: postId, is_locked: false }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // Parent comment check

      await expect(service.createComment(postId, authorId, replyData)).rejects.toThrow(NotFoundError);
    });

    it('should throw ValidationError when parent comment belongs to different post', async () => {
      const parentCommentId = 'parent-comment-123';
      const replyData: CreateCommentData = {
        content: 'Test reply',
        parentCommentId,
      };

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Post check
          rows: [{ id: postId, is_locked: false }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Parent comment check
          rows: [{ id: parentCommentId, post_id: 'different-post' }],
          rowCount: 1,
        });

      await expect(service.createComment(postId, authorId, replyData)).rejects.toThrow(ValidationError);
    });
  });

  describe('getPostComments', () => {
    const postId = 'post-123';

    it('should return comments for a post', async () => {
      mockPool.query
        .mockResolvedValueOnce({ // Post check
          rows: [{ id: postId }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Count
          rows: [{ count: '2' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Comments
          rows: [
            {
              id: 'comment-1',
              post_id: postId,
              parent_id: null,
              author_id: 'agent-1',
              author_name: 'Agent One',
              author_reputation: 100,
              content: 'Comment 1',
              created_at: new Date(),
              updated_at: new Date(),
              vote_count: 5,
              reply_count: 2,
              user_vote: null,
            },
            {
              id: 'comment-2',
              post_id: postId,
              parent_id: null,
              author_id: 'agent-2',
              author_name: 'Agent Two',
              author_reputation: 200,
              content: 'Comment 2',
              created_at: new Date(),
              updated_at: new Date(),
              vote_count: 3,
              reply_count: 0,
              user_vote: null,
            },
          ],
          rowCount: 2,
        });

      const result = await service.getPostComments(postId, {});

      expect(result.comments).toHaveLength(2);
      expect(result.comments[0].id).toBe('comment-1');
      expect(result.pagination.total).toBe(2);
    });

    it('should throw NotFoundError when post does not exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(service.getPostComments(postId, {})).rejects.toThrow(NotFoundError);
    });

    it('should support threadView with replies', async () => {
      mockPool.query
        .mockResolvedValueOnce({ // Post check
          rows: [{ id: postId }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Count
          rows: [{ count: '1' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Top-level comments
          rows: [
            {
              id: 'comment-1',
              post_id: postId,
              parent_id: null,
              author_id: 'agent-1',
              author_name: 'Agent One',
              author_reputation: 100,
              content: 'Top comment',
              created_at: new Date(),
              updated_at: new Date(),
              vote_count: 5,
              reply_count: 1,
              user_vote: null,
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Replies
          rows: [
            {
              id: 'comment-2',
              post_id: postId,
              parent_id: 'comment-1',
              author_id: 'agent-2',
              author_name: 'Agent Two',
              author_reputation: 200,
              content: 'Reply',
              created_at: new Date(),
              updated_at: new Date(),
              vote_count: 2,
              reply_count: 0,
              user_vote: null,
            },
          ],
          rowCount: 1,
        });

      const result = await service.getPostComments(postId, { threadView: true });

      expect(result.comments).toHaveLength(1);
      expect((result.comments[0] as any).replies).toHaveLength(1);
    });

    it('should support sorting by newest, oldest, and top', async () => {
      // Mock for newest
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: postId }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.getPostComments(postId, { sort: 'newest' });

      // Mock for oldest
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: postId }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.getPostComments(postId, { sort: 'oldest' });

      // Mock for top
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: postId }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.getPostComments(postId, { sort: 'top' });

      expect(mockPool.query).toHaveBeenCalled();
    });
  });

  describe('getCommentById', () => {
    const commentId = 'comment-123';

    it('should return a comment by ID', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          id: commentId,
          post_id: 'post-123',
          parent_id: null,
          author_id: 'agent-123',
          author_name: 'Test Agent',
          author_reputation: 100,
          content: 'Test comment',
          created_at: new Date(),
          updated_at: new Date(),
          vote_count: 5,
          reply_count: 2,
          user_vote: null,
        }],
        rowCount: 1,
      });

      const result = await service.getCommentById(commentId);

      expect(result.id).toBe(commentId);
      expect(result.author.name).toBe('Test Agent');
    });

    it('should throw NotFoundError when comment does not exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(service.getCommentById(commentId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('getCommentReplies', () => {
    const commentId = 'comment-123';

    it('should return replies to a comment', async () => {
      mockPool.query
        .mockResolvedValueOnce({ // Comment check
          rows: [{ id: commentId }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Count
          rows: [{ count: '1' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Replies
          rows: [{
            id: 'reply-123',
            post_id: 'post-123',
            parent_id: commentId,
            author_id: 'agent-123',
            author_name: 'Test Agent',
            author_reputation: 100,
            content: 'Test reply',
            created_at: new Date(),
            updated_at: new Date(),
            vote_count: 3,
            reply_count: 0,
            user_vote: null,
          }],
          rowCount: 1,
        });

      const result = await service.getCommentReplies(commentId, {});

      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].parentId).toBe(commentId);
    });

    it('should throw NotFoundError when comment does not exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(service.getCommentReplies(commentId, {})).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateComment', () => {
    const commentId = 'comment-123';
    const editorId = 'agent-123';
    const updateData: UpdateCommentData = {
      content: 'Updated content',
      editReason: 'Fixed typo',
    };

    it('should update a comment successfully', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Get current comment
          rows: [{
            id: commentId,
            author_id: editorId,
            content: 'Old content',
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }) // Insert edit history
        .mockResolvedValueOnce({ // Update comment
          rows: [{
            id: commentId,
            post_id: 'post-123',
            parent_id: null,
            author_id: editorId,
            content: updateData.content,
            created_at: new Date(),
            updated_at: new Date(),
            vote_count: 5,
            reply_count: 2,
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      const result = await service.updateComment(commentId, editorId, updateData);

      expect(result.content).toBe(updateData.content);
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw ValidationError for invalid content length', async () => {
      await expect(service.updateComment(commentId, editorId, { content: '' })).rejects.toThrow(ValidationError);
      await expect(service.updateComment(commentId, editorId, { content: 'a'.repeat(10001) })).rejects.toThrow(ValidationError);
    });

    it('should throw NotFoundError when comment does not exist', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // Get current comment

      await expect(service.updateComment(commentId, editorId, updateData)).rejects.toThrow(NotFoundError);
    });

    it('should throw ForbiddenError when editor is not the author', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Get current comment
          rows: [{
            id: commentId,
            author_id: 'different-agent',
            content: 'Old content',
          }],
          rowCount: 1,
        });

      await expect(service.updateComment(commentId, editorId, updateData)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteComment', () => {
    const commentId = 'comment-123';
    const deleterId = 'agent-123';

    it('should delete a comment successfully', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Get current comment
          rows: [{
            id: commentId,
            author_id: deleterId,
            post_id: 'post-123',
            parent_id: null,
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }) // Soft delete
        .mockResolvedValueOnce({ rowCount: 1 }) // Update post comment count
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      const result = await service.deleteComment(commentId, deleterId);

      expect(result.message).toBe('Comment deleted successfully');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should update parent reply count when deleting a reply', async () => {
      const parentId = 'parent-comment-123';
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Get current comment
          rows: [{
            id: commentId,
            author_id: deleterId,
            post_id: 'post-123',
            parent_id: parentId,
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }) // Soft delete
        .mockResolvedValueOnce({ rowCount: 1 }) // Update post comment count
        .mockResolvedValueOnce({ rowCount: 1 }) // Update parent reply count
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      await service.deleteComment(commentId, deleterId);

      expect(mockClient.query).toHaveBeenCalledWith(
        'UPDATE comments SET reply_count = reply_count - 1 WHERE id = $1',
        [parentId]
      );
    });

    it('should throw NotFoundError when comment does not exist', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // Get current comment

      await expect(service.deleteComment(commentId, deleterId)).rejects.toThrow(NotFoundError);
    });

    it('should throw ForbiddenError when deleter is not the author', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Get current comment
          rows: [{
            id: commentId,
            author_id: 'different-agent',
            post_id: 'post-123',
            parent_id: null,
          }],
          rowCount: 1,
        });

      await expect(service.deleteComment(commentId, deleterId)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getCommentEditHistory', () => {
    const commentId = 'comment-123';

    it('should return edit history for a comment', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: 'edit-1',
            editor_id: 'agent-123',
            editor_name: 'Test Agent',
            previous_content: 'Old content 1',
            edit_reason: 'Fixed typo',
            created_at: new Date(),
          },
          {
            id: 'edit-2',
            editor_id: 'agent-123',
            editor_name: 'Test Agent',
            previous_content: 'Old content 2',
            edit_reason: 'Improved clarity',
            created_at: new Date(),
          },
        ],
        rowCount: 2,
      });

      const result = await service.getCommentEditHistory(commentId);

      expect(result).toHaveLength(2);
      expect(result[0].previousContent).toBe('Old content 1');
      expect(result[1].editReason).toBe('Improved clarity');
    });

    it('should return empty array when no edit history exists', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await service.getCommentEditHistory(commentId);

      expect(result).toHaveLength(0);
    });
  });
});
