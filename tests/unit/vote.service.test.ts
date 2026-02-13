import { Pool } from 'pg';
import { VoteService, CreateVoteData } from '@modules/votes/vote.service';
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

describe('VoteService', () => {
  let service: VoteService;
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

    service = new VoteService(mockPool as Pool);
    jest.clearAllMocks();
  });

  describe('vote', () => {
    const voterId = 'agent-123';
    const voteData: CreateVoteData = {
      targetType: 'post',
      targetId: 'post-123',
      voteType: 1,
    };

    it('should cast a new upvote on a post', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Check target exists
          rows: [{ id: voteData.targetId, author_id: 'different-agent' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Check existing vote
        .mockResolvedValueOnce({ // Insert vote
          rows: [{
            id: 'vote-123',
            vote_type: 1,
            created_at: new Date(),
            updated_at: new Date(),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }) // Update vote count
        .mockResolvedValueOnce({ // Get updated vote count
          rows: [{ vote_count: 1 }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      const result = await service.vote(voterId, voteData);

      expect(result.voteType).toBe(1);
      expect(result.totalVotes).toBe(1);
      expect(result.message).toBe('Vote recorded');
    });

    it('should cast a new downvote on a comment', async () => {
      const commentVote: CreateVoteData = {
        targetType: 'comment',
        targetId: 'comment-123',
        voteType: -1,
      };

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Check target exists
          rows: [{ id: commentVote.targetId, author_id: 'different-agent' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Check existing vote
        .mockResolvedValueOnce({ // Insert vote
          rows: [{
            id: 'vote-123',
            vote_type: -1,
            created_at: new Date(),
            updated_at: new Date(),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }) // Update vote count
        .mockResolvedValueOnce({ // Get updated vote count
          rows: [{ vote_count: -1 }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      const result = await service.vote(voterId, commentVote);

      expect(result.voteType).toBe(-1);
      expect(result.totalVotes).toBe(-1);
    });

    it('should update existing vote when changing vote type', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Check target exists
          rows: [{ id: voteData.targetId, author_id: 'different-agent' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Check existing vote
          rows: [{ id: 'vote-123', vote_type: -1 }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Update vote
          rows: [{
            id: 'vote-123',
            vote_type: 1,
            created_at: new Date(),
            updated_at: new Date(),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }) // Update vote count
        .mockResolvedValueOnce({ // Get updated vote count
          rows: [{ vote_count: 2 }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      const result = await service.vote(voterId, voteData);

      expect(result.voteType).toBe(1);
      expect(result.message).toBe('Vote updated');
    });

    it('should be idempotent when voting with same type', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Check target exists
          rows: [{ id: voteData.targetId, author_id: 'different-agent' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Check existing vote
          rows: [{ id: 'vote-123', vote_type: 1 }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ // Get current vote count
          rows: [{ vote_count: 5 }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      const result = await service.vote(voterId, voteData);

      expect(result.voteType).toBe(1);
      expect(result.message).toBe('Vote already recorded');
    });

    it('should throw ValidationError for invalid vote type', async () => {
      await expect(service.vote(voterId, {
        ...voteData,
        voteType: 0 as any,
      })).rejects.toThrow(ValidationError);

      await expect(service.vote(voterId, {
        ...voteData,
        voteType: 2 as any,
      })).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid target type', async () => {
      await expect(service.vote(voterId, {
        ...voteData,
        targetType: 'invalid' as any,
      })).rejects.toThrow(ValidationError);
    });

    it('should throw NotFoundError when target does not exist', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // Check target exists

      await expect(service.vote(voterId, voteData)).rejects.toThrow(NotFoundError);
    });

    it('should throw ForbiddenError when voting on own content', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Check target exists
          rows: [{ id: voteData.targetId, author_id: voterId }],
          rowCount: 1,
        });

      await expect(service.vote(voterId, voteData)).rejects.toThrow(ForbiddenError);
    });

    it('should handle database errors and rollback', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockRejectedValueOnce(new Error('Database error'));

      await expect(service.vote(voterId, voteData)).rejects.toThrow('Database error');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('unvote', () => {
    const voterId = 'agent-123';
    const targetType = 'post';
    const targetId = 'post-123';

    it('should remove a vote successfully', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ // Check vote exists
          rows: [{ id: 'vote-123', vote_type: 1 }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rowCount: 1 }) // Delete vote
        .mockResolvedValueOnce({ rowCount: 1 }) // Update vote count
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      const result = await service.unvote(voterId, targetType, targetId);

      expect(result.message).toBe('Vote removed');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should be idempotent when no vote exists', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Check vote exists
        .mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      const result = await service.unvote(voterId, targetType, targetId);

      expect(result.message).toBe('No vote to remove');
    });

    it('should throw ValidationError for invalid target type', async () => {
      await expect(service.unvote(voterId, 'invalid' as any, targetId)).rejects.toThrow(ValidationError);
    });

    it('should handle database errors and rollback', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // BEGIN
        .mockRejectedValueOnce(new Error('Database error'));

      await expect(service.unvote(voterId, targetType, targetId)).rejects.toThrow('Database error');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('getMyVotes', () => {
    const voterId = 'agent-123';

    it('should return user votes with pagination', async () => {
      mockPool.query
        .mockResolvedValueOnce({ // Votes query
          rows: [
            {
              id: 'vote-1',
              vote_type: 1,
              created_at: new Date(),
              updated_at: new Date(),
              target_type: 'post',
              target_id: 'post-123',
              target: {
                id: 'post-123',
                title: 'Test Post',
                forumId: 'forum-123',
                authorId: 'agent-456',
                voteCount: 10,
                commentCount: 5,
                createdAt: new Date(),
              },
            },
            {
              id: 'vote-2',
              vote_type: -1,
              created_at: new Date(),
              updated_at: new Date(),
              target_type: 'comment',
              target_id: 'comment-123',
              target: {
                id: 'comment-123',
                postId: 'post-456',
                authorId: 'agent-789',
                voteCount: 3,
                createdAt: new Date(),
              },
            },
          ],
          rowCount: 2,
        })
        .mockResolvedValueOnce({ // Count query
          rows: [{ count: '2' }],
          rowCount: 1,
        });

      const result = await service.getMyVotes(voterId, { limit: 50, offset: 0 });

      expect(result.votes).toHaveLength(2);
      expect(result.votes[0].targetType).toBe('post');
      expect(result.votes[1].targetType).toBe('comment');
      expect(result.pagination.total).toBe(2);
    });

    it('should return empty array when no votes exist', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 });

      const result = await service.getMyVotes(voterId);

      expect(result.votes).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('should support pagination parameters', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ count: '100' }], rowCount: 1 });

      const result = await service.getMyVotes(voterId, { limit: 20, offset: 40 });

      expect(result.pagination.limit).toBe(20);
      expect(result.pagination.offset).toBe(40);
    });
  });

  describe('getVoteStatus', () => {
    const voterId = 'agent-123';
    const targetType = 'post';
    const targetId = 'post-123';

    it('should return user vote status when vote exists', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ vote_type: 1 }],
        rowCount: 1,
      });

      const result = await service.getVoteStatus(voterId, targetType, targetId);

      expect(result.userVote).toBe(1);
    });

    it('should return null when no vote exists', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await service.getVoteStatus(voterId, targetType, targetId);

      expect(result.userVote).toBeNull();
    });

    it('should return null when voterId is undefined', async () => {
      const result = await service.getVoteStatus(undefined, targetType, targetId);

      expect(result.userVote).toBeNull();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });
});
