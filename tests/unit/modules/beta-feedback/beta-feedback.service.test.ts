import { Pool } from 'pg';
import { BetaFeedbackService } from '@modules/beta-feedback/beta-feedback.service';
import {
  BetaFeedback,
  CreateFeedbackDto,
  UpdateFeedbackDto,
  FeedbackComment,
  CreateFeedbackCommentDto,
  BetaMetric,
  RecordMetricDto,
  FeedbackStats,
  FeedbackStatus,
  FeedbackSeverity,
  FeedbackCategory,
} from '@modules/beta-feedback/beta-feedback.types';

// Mock the Logger
jest.mock('@config/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('BetaFeedbackService', () => {
  let service: BetaFeedbackService;
  let mockPool: any;
  let mockLogger: any;

  // Test data fixtures
  const testAgentId = 'agent-123';
  const testFeedbackId = 'feedback-123';
  const testCommentId = 'comment-123';
  const testMetricId = 'metric-123';

  const mockFeedbackRow = {
    id: testFeedbackId,
    agent_id: testAgentId,
    category: 'bug' as FeedbackCategory,
    severity: 'high' as FeedbackSeverity,
    status: 'new' as FeedbackStatus,
    title: 'Test Feedback',
    description: 'Test feedback description',
    endpoint: '/api/test',
    http_method: 'GET',
    response_code: 500,
    error_message: 'Internal Server Error',
    agent_version: '1.0.0',
    sdk_version: '2.0.0',
    user_agent: 'Mozilla/5.0',
    ip_address: '192.168.1.1',
    created_at: new Date(),
    updated_at: new Date(),
    resolved_at: null,
    resolved_by: null,
    resolution_notes: null,
    related_pr: null,
    related_issue: null,
  };

  const mockCommentRow = {
    id: testCommentId,
    feedback_id: testFeedbackId,
    agent_id: testAgentId,
    comment: 'Test comment',
    is_internal: false,
    created_at: new Date(),
  };

  const mockMetricRow = {
    id: testMetricId,
    agent_id: testAgentId,
    metric_type: 'response_time',
    metric_value: 150,
    metric_unit: 'ms',
    endpoint: '/api/test',
    operation: 'query',
    metadata: JSON.stringify({ extra: 'data' }),
    recorded_at: new Date(),
  };

  beforeEach(() => {
    // Get the mocked logger
    const { logger } = require('@config/logger');
    mockLogger = logger;

    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    };

    service = new BetaFeedbackService(mockPool, mockLogger);
    jest.clearAllMocks();
  });

  describe('createFeedback', () => {
    it('should create feedback with all required fields', async () => {
      const feedbackData: CreateFeedbackDto = {
        category: 'bug',
        severity: 'high',
        title: 'Test Feedback',
        description: 'Test feedback description',
        endpoint: '/api/test',
        httpMethod: 'GET',
        responseCode: 500,
        errorMessage: 'Internal Server Error',
        agentVersion: '1.0.0',
        sdkVersion: '2.0.0',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockFeedbackRow],
        rowCount: 1,
      } as any);

      const result = await service.createFeedback(testAgentId, feedbackData, '192.168.1.1', 'Mozilla/5.0');

      expect(result.id).toBe(testFeedbackId);
      expect(result.category).toBe('bug');
      expect(result.severity).toBe('high');
      expect(result.title).toBe('Test Feedback');
      expect(mockLogger.info).toHaveBeenCalledWith('Creating beta feedback', {
        agentId: testAgentId,
        category: 'bug',
      });
      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should create feedback with various categories', async () => {
      const categories: FeedbackCategory[] = ['bug', 'feature', 'performance', 'usability', 'documentation', 'other'];

      for (const category of categories) {
        mockPool.query.mockResolvedValueOnce({
          rows: [{ ...mockFeedbackRow, category }],
          rowCount: 1,
        } as any);

        const feedbackData: CreateFeedbackDto = {
          category,
          severity: 'medium',
          title: `Test ${category}`,
          description: 'Description',
        };

        const result = await service.createFeedback(testAgentId, feedbackData);
        expect(result.category).toBe(category);
      }
    });

    it('should create feedback with various severities', async () => {
      const severities: FeedbackSeverity[] = ['critical', 'high', 'medium', 'low'];

      for (const severity of severities) {
        mockPool.query.mockResolvedValueOnce({
          rows: [{ ...mockFeedbackRow, severity }],
          rowCount: 1,
        } as any);

        const feedbackData: CreateFeedbackDto = {
          category: 'bug',
          severity,
          title: 'Test',
          description: 'Description',
        };

        const result = await service.createFeedback(testAgentId, feedbackData);
        expect(result.severity).toBe(severity);
      }
    });

    it('should create feedback with minimal required fields', async () => {
      const feedbackData: CreateFeedbackDto = {
        category: 'feature',
        severity: 'low',
        title: 'Simple feedback',
        description: 'Simple description',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockFeedbackRow, category: 'feature', severity: 'low', title: 'Simple feedback' }],
        rowCount: 1,
      } as any);

      const result = await service.createFeedback(testAgentId, feedbackData);

      expect(result.title).toBe('Simple feedback');
      expect(result.category).toBe('feature');
    });

    it('should pass IP address and user agent when provided', async () => {
      const feedbackData: CreateFeedbackDto = {
        category: 'bug',
        severity: 'high',
        title: 'Test',
        description: 'Description',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockFeedbackRow],
        rowCount: 1,
      } as any);

      const ipAddress = '10.0.0.1';
      const userAgent = 'Custom User Agent';

      await service.createFeedback(testAgentId, feedbackData, ipAddress, userAgent);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO beta_feedback'),
        expect.arrayContaining([ipAddress, userAgent])
      );
    });

    it('should handle database errors during creation', async () => {
      const feedbackData: CreateFeedbackDto = {
        category: 'bug',
        severity: 'high',
        title: 'Test',
        description: 'Description',
      };

      const dbError = new Error('Database connection failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(service.createFeedback(testAgentId, feedbackData)).rejects.toThrow(
        'Database connection failed'
      );

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to create feedback', {
        error: dbError,
        agentId: testAgentId,
      });
    });
  });

  describe('getFeedbackById', () => {
    it('should retrieve feedback by ID without agent filter', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [mockFeedbackRow],
        rowCount: 1,
      } as any);

      const result = await service.getFeedbackById(testFeedbackId);

      expect(result?.id).toBe(testFeedbackId);
      expect(result?.agentId).toBe(testAgentId);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        [testFeedbackId]
      );
    });

    it('should retrieve feedback with agent filter for agent-specific access', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [mockFeedbackRow],
        rowCount: 1,
      } as any);

      const result = await service.getFeedbackById(testFeedbackId, testAgentId);

      expect(result?.id).toBe(testFeedbackId);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND agent_id = $2'),
        [testFeedbackId, testAgentId]
      );
    });

    it('should return null when feedback not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await service.getFeedbackById(testFeedbackId);

      expect(result).toBeNull();
    });

    it('should return null when feedback exists but agent filter fails', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await service.getFeedbackById(testFeedbackId, 'different-agent-id');

      expect(result).toBeNull();
    });

    it('should handle database errors during retrieval', async () => {
      const dbError = new Error('Connection timeout');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(service.getFeedbackById(testFeedbackId)).rejects.toThrow('Connection timeout');

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to get feedback', {
        error: dbError,
        feedbackId: testFeedbackId,
      });
    });
  });

  describe('listFeedback', () => {
    it('should list all feedback without filters', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ count: 10 }],
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [mockFeedbackRow, { ...mockFeedbackRow, id: 'feedback-124' }],
          rowCount: 2,
        } as any);

      const result = await service.listFeedback({});

      expect(result.total).toBe(10);
      expect(result.feedback).toHaveLength(2);
      expect(result.feedback[0].id).toBe(testFeedbackId);
    });

    it('should filter feedback by agent ID', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ count: 5 }],
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [mockFeedbackRow],
          rowCount: 1,
        } as any);

      const result = await service.listFeedback({ agentId: testAgentId });

      expect(result.total).toBe(5);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('agent_id = $1'),
        expect.arrayContaining([testAgentId])
      );
    });

    it('should filter feedback by category', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ count: 3 }],
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [{ ...mockFeedbackRow, category: 'bug' }],
          rowCount: 1,
        } as any);

      const result = await service.listFeedback({ category: 'bug' });

      expect(result.total).toBe(3);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('category = $1'),
        expect.arrayContaining(['bug'])
      );
    });

    it('should filter feedback by severity', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ count: 2 }],
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [{ ...mockFeedbackRow, severity: 'critical' }],
          rowCount: 1,
        } as any);

      const result = await service.listFeedback({ severity: 'critical' });

      expect(result.total).toBe(2);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('severity = $1'),
        expect.arrayContaining(['critical'])
      );
    });

    it('should filter feedback by status', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ count: 4 }],
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [{ ...mockFeedbackRow, status: 'resolved' }],
          rowCount: 1,
        } as any);

      const result = await service.listFeedback({ status: 'resolved' });

      expect(result.total).toBe(4);
    });

    it('should apply multiple filters simultaneously', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ count: 1 }],
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [mockFeedbackRow],
          rowCount: 1,
        } as any);

      const result = await service.listFeedback({
        agentId: testAgentId,
        category: 'bug',
        severity: 'high',
        status: 'new',
      });

      expect(result.total).toBe(1);
      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should apply pagination with limit and offset', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ count: 100 }],
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [mockFeedbackRow],
          rowCount: 1,
        } as any);

      const result = await service.listFeedback({ limit: 25, offset: 50 });

      expect(result.total).toBe(100);
      const callArgs = mockPool.query.mock.calls[1][1];
      expect(callArgs).toContain(25); // limit
      expect(callArgs).toContain(50); // offset
    });

    it('should use default limit and offset when not specified', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ count: 100 }],
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [mockFeedbackRow],
          rowCount: 1,
        } as any);

      await service.listFeedback({});

      const callArgs = mockPool.query.mock.calls[1][1];
      expect(callArgs[callArgs.length - 2]).toBe(50); // default limit
      expect(callArgs[callArgs.length - 1]).toBe(0); // default offset
    });

    it('should handle database errors during listing', async () => {
      const dbError = new Error('Query failed');
      // First call succeeds (count query), second call fails (fetch query)
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: 5 }],
        rowCount: 1,
      } as any);
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(service.listFeedback({ agentId: testAgentId })).rejects.toThrow('Query failed');

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to list feedback', expect.any(Object));
    });
  });

  describe('updateFeedback', () => {
    it('should update feedback status', async () => {
      const updateData: UpdateFeedbackDto = {
        status: 'reviewing',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockFeedbackRow, status: 'reviewing' }],
        rowCount: 1,
      } as any);

      const result = await service.updateFeedback(testFeedbackId, updateData);

      expect(result.status).toBe('reviewing');
      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should set resolved_at when marking as resolved', async () => {
      const updateData: UpdateFeedbackDto = {
        status: 'resolved',
      };

      const resolvedRow = {
        ...mockFeedbackRow,
        status: 'resolved',
        resolved_at: new Date(),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [resolvedRow],
        rowCount: 1,
      } as any);

      const result = await service.updateFeedback(testFeedbackId, updateData);

      expect(result.status).toBe('resolved');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('resolved_at'),
        expect.any(Array)
      );
    });

    it('should set resolved_by when provided', async () => {
      const updateData: UpdateFeedbackDto = {
        status: 'resolved',
      };

      const resolveUser = 'admin-user-123';

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockFeedbackRow, status: 'resolved', resolved_by: resolveUser }],
        rowCount: 1,
      } as any);

      await service.updateFeedback(testFeedbackId, updateData, resolveUser);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('resolved_by'),
        expect.arrayContaining([resolveUser])
      );
    });

    it('should mark as closed with resolved_at', async () => {
      const updateData: UpdateFeedbackDto = {
        status: 'closed',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockFeedbackRow, status: 'closed', resolved_at: new Date() }],
        rowCount: 1,
      } as any);

      const result = await service.updateFeedback(testFeedbackId, updateData);

      expect(result.status).toBe('closed');
    });

    it('should update resolution notes', async () => {
      const updateData: UpdateFeedbackDto = {
        resolutionNotes: 'Fixed in version 2.1.0',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockFeedbackRow, resolution_notes: 'Fixed in version 2.1.0' }],
        rowCount: 1,
      } as any);

      const result = await service.updateFeedback(testFeedbackId, updateData);

      expect(result.resolutionNotes).toBe('Fixed in version 2.1.0');
    });

    it('should update related PR reference', async () => {
      const updateData: UpdateFeedbackDto = {
        relatedPr: 'https://github.com/org/repo/pull/123',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockFeedbackRow, related_pr: 'https://github.com/org/repo/pull/123' }],
        rowCount: 1,
      } as any);

      const result = await service.updateFeedback(testFeedbackId, updateData);

      expect(result.relatedPr).toBe('https://github.com/org/repo/pull/123');
    });

    it('should update related issue reference', async () => {
      const updateData: UpdateFeedbackDto = {
        relatedIssue: 'https://github.com/org/repo/issues/456',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockFeedbackRow, related_issue: 'https://github.com/org/repo/issues/456' }],
        rowCount: 1,
      } as any);

      const result = await service.updateFeedback(testFeedbackId, updateData);

      expect(result.relatedIssue).toBe('https://github.com/org/repo/issues/456');
    });

    it('should update multiple fields at once', async () => {
      const updateData: UpdateFeedbackDto = {
        status: 'resolved',
        resolutionNotes: 'Fixed',
        relatedPr: 'pr-link',
        relatedIssue: 'issue-link',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{
          ...mockFeedbackRow,
          status: 'resolved',
          resolution_notes: 'Fixed',
          related_pr: 'pr-link',
          related_issue: 'issue-link',
          resolved_at: new Date(),
        }],
        rowCount: 1,
      } as any);

      const result = await service.updateFeedback(testFeedbackId, updateData);

      expect(result.status).toBe('resolved');
      expect(result.resolutionNotes).toBe('Fixed');
      expect(result.relatedPr).toBe('pr-link');
      expect(result.relatedIssue).toBe('issue-link');
    });

    it('should throw error when no updates provided', async () => {
      const emptyUpdate: UpdateFeedbackDto = {};

      await expect(service.updateFeedback(testFeedbackId, emptyUpdate)).rejects.toThrow(
        'No updates provided'
      );
    });

    it('should throw error when feedback not found', async () => {
      const updateData: UpdateFeedbackDto = {
        status: 'reviewing',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await expect(service.updateFeedback(testFeedbackId, updateData)).rejects.toThrow(
        'Feedback not found'
      );
    });

    it('should handle database errors during update', async () => {
      const updateData: UpdateFeedbackDto = {
        status: 'reviewing',
      };

      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(service.updateFeedback(testFeedbackId, updateData)).rejects.toThrow('Update failed');

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to update feedback', {
        error: dbError,
        feedbackId: testFeedbackId,
      });
    });
  });

  describe('addComment', () => {
    it('should add a public comment', async () => {
      const commentData: CreateFeedbackCommentDto = {
        comment: 'This is a test comment',
        isInternal: false,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockCommentRow, comment: 'This is a test comment' }],
        rowCount: 1,
      } as any);

      const result = await service.addComment(testFeedbackId, testAgentId, commentData);

      expect(result.id).toBe(testCommentId);
      expect(result.comment).toBe('This is a test comment');
      expect(result.isInternal).toBe(false);
      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should add an internal comment', async () => {
      const commentData: CreateFeedbackCommentDto = {
        comment: 'Internal notes for the team',
        isInternal: true,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockCommentRow, is_internal: true, comment: 'Internal notes for the team' }],
        rowCount: 1,
      } as any);

      const result = await service.addComment(testFeedbackId, testAgentId, commentData);

      expect(result.isInternal).toBe(true);
      expect(result.comment).toBe('Internal notes for the team');
    });

    it('should default isInternal to false when not specified', async () => {
      const commentData: CreateFeedbackCommentDto = {
        comment: 'Simple comment',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockCommentRow, comment: 'Simple comment', is_internal: false }],
        rowCount: 1,
      } as any);

      const result = await service.addComment(testFeedbackId, testAgentId, commentData);

      expect(result.isInternal).toBe(false);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([testFeedbackId, testAgentId, 'Simple comment', false])
      );
    });

    it('should handle database errors when adding comment', async () => {
      const commentData: CreateFeedbackCommentDto = {
        comment: 'Test',
      };

      const dbError = new Error('Insert failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(service.addComment(testFeedbackId, testAgentId, commentData)).rejects.toThrow(
        'Insert failed'
      );

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to add comment', {
        error: dbError,
        feedbackId: testFeedbackId,
      });
    });
  });

  describe('getComments', () => {
    it('should retrieve public comments by default', async () => {
      const comment1 = { ...mockCommentRow, id: 'comment-1', is_internal: false };
      const comment2 = { ...mockCommentRow, id: 'comment-2', is_internal: false };

      mockPool.query.mockResolvedValueOnce({
        rows: [comment1, comment2],
        rowCount: 2,
      } as any);

      const result = await service.getComments(testFeedbackId);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('comment-1');
      expect(result[1].id).toBe('comment-2');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('is_internal = false'),
        [testFeedbackId]
      );
    });

    it('should include internal comments when requested', async () => {
      const comment1 = { ...mockCommentRow, id: 'comment-1', is_internal: false };
      const comment2 = { ...mockCommentRow, id: 'comment-2', is_internal: true };

      mockPool.query.mockResolvedValueOnce({
        rows: [comment1, comment2],
        rowCount: 2,
      } as any);

      const result = await service.getComments(testFeedbackId, true);

      expect(result).toHaveLength(2);
      expect(result.some((c) => c.isInternal)).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.not.stringContaining('is_internal = false'),
        [testFeedbackId]
      );
    });

    it('should return empty array when no comments exist', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await service.getComments(testFeedbackId);

      expect(result).toEqual([]);
    });

    it('should order comments by creation date ascending', async () => {
      const now = new Date();
      const comment1 = { ...mockCommentRow, id: 'comment-1', created_at: new Date(now.getTime() - 1000) };
      const comment2 = { ...mockCommentRow, id: 'comment-2', created_at: now };

      mockPool.query.mockResolvedValueOnce({
        rows: [comment1, comment2],
        rowCount: 2,
      } as any);

      const result = await service.getComments(testFeedbackId);

      expect(result[0].id).toBe('comment-1');
      expect(result[1].id).toBe('comment-2');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at ASC'),
        [testFeedbackId]
      );
    });

    it('should handle database errors when fetching comments', async () => {
      const dbError = new Error('Query error');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(service.getComments(testFeedbackId)).rejects.toThrow('Query error');

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to get comments', {
        error: dbError,
        feedbackId: testFeedbackId,
      });
    });
  });

  describe('recordMetric', () => {
    it('should record a metric with all fields', async () => {
      const metricData: RecordMetricDto = {
        metricType: 'response_time',
        metricValue: 150,
        metricUnit: 'ms',
        endpoint: '/api/test',
        operation: 'query',
        metadata: { extra: 'data' },
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockMetricRow],
        rowCount: 1,
      } as any);

      const result = await service.recordMetric(testAgentId, metricData);

      expect(result.id).toBe(testMetricId);
      expect(result.metricType).toBe('response_time');
      expect(result.metricValue).toBe(150);
      expect(result.metricUnit).toBe('ms');
      expect(result.metadata?.extra).toBe('data');
    });

    it('should record metric without optional fields', async () => {
      const metricData: RecordMetricDto = {
        metricType: 'cpu_usage',
        metricValue: 45.5,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{
          ...mockMetricRow,
          metric_type: 'cpu_usage',
          metric_value: 45.5,
          metric_unit: null,
          metadata: null,
        }],
        rowCount: 1,
      } as any);

      const result = await service.recordMetric(testAgentId, metricData);

      expect(result.metricType).toBe('cpu_usage');
      expect(result.metricValue).toBe(45.5);
    });

    it('should stringify metadata when provided', async () => {
      const metricData: RecordMetricDto = {
        metricType: 'error_rate',
        metricValue: 0.02,
        metadata: { count: 5, total: 250 },
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockMetricRow],
        rowCount: 1,
      } as any);

      await service.recordMetric(testAgentId, metricData);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          testAgentId,
          'error_rate',
          0.02,
          undefined,
          undefined,
          undefined,
          JSON.stringify({ count: 5, total: 250 }),
        ])
      );
    });

    it('should handle null metadata', async () => {
      const metricData: RecordMetricDto = {
        metricType: 'memory_usage',
        metricValue: 256,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockMetricRow, metadata: null }],
        rowCount: 1,
      } as any);

      await service.recordMetric(testAgentId, metricData);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([null])
      );
    });

    it('should handle database errors when recording metric', async () => {
      const metricData: RecordMetricDto = {
        metricType: 'response_time',
        metricValue: 100,
      };

      const dbError = new Error('Insert failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(service.recordMetric(testAgentId, metricData)).rejects.toThrow('Insert failed');

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to record metric', {
        error: dbError,
        agentId: testAgentId,
      });
    });
  });

  describe('getStats', () => {
    it('should get statistics for all feedback', async () => {
      const statsRow = {
        total: 50,
        bug_count: 20,
        feature_count: 15,
        performance_count: 10,
        usability_count: 3,
        documentation_count: 2,
        other_count: 0,
        critical_count: 5,
        high_count: 15,
        medium_count: 20,
        low_count: 10,
        new_count: 15,
        reviewing_count: 10,
        in_progress_count: 15,
        resolved_count: 8,
        closed_count: 2,
        wont_fix_count: 0,
        recent_count: 12,
        avg_resolution_hours: 48.5,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [statsRow],
        rowCount: 1,
      } as any);

      const result = await service.getStats();

      expect(result.total).toBe(50);
      expect(result.byCategory.bug).toBe(20);
      expect(result.byCategory.feature).toBe(15);
      expect(result.bySeverity.critical).toBe(5);
      expect(result.bySeverity.high).toBe(15);
      expect(result.byStatus.new).toBe(15);
      expect(result.byStatus.resolved).toBe(8);
      expect(result.recentCount).toBe(12);
      expect(result.avgResolutionTime).toBe(48.5);
    });

    it('should get statistics filtered by agent', async () => {
      const statsRow = {
        total: 5,
        bug_count: 2,
        feature_count: 2,
        performance_count: 1,
        usability_count: 0,
        documentation_count: 0,
        other_count: 0,
        critical_count: 1,
        high_count: 2,
        medium_count: 2,
        low_count: 0,
        new_count: 2,
        reviewing_count: 1,
        in_progress_count: 1,
        resolved_count: 1,
        closed_count: 0,
        wont_fix_count: 0,
        recent_count: 3,
        avg_resolution_hours: 24.0,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [statsRow],
        rowCount: 1,
      } as any);

      const result = await service.getStats(testAgentId);

      expect(result.total).toBe(5);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE agent_id = $1'),
        [testAgentId]
      );
    });

    it('should handle null avgResolutionTime when no resolved feedback', async () => {
      const statsRow = {
        total: 5,
        bug_count: 2,
        feature_count: 3,
        performance_count: 0,
        usability_count: 0,
        documentation_count: 0,
        other_count: 0,
        critical_count: 1,
        high_count: 2,
        medium_count: 2,
        low_count: 0,
        new_count: 5,
        reviewing_count: 0,
        in_progress_count: 0,
        resolved_count: 0,
        closed_count: 0,
        wont_fix_count: 0,
        recent_count: 5,
        avg_resolution_hours: null,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [statsRow],
        rowCount: 1,
      } as any);

      const result = await service.getStats();

      expect(result.avgResolutionTime).toBeUndefined();
    });

    it('should parse all numeric fields correctly', async () => {
      const statsRow = {
        total: '100',
        bug_count: '45',
        feature_count: '30',
        performance_count: '15',
        usability_count: '5',
        documentation_count: '3',
        other_count: '2',
        critical_count: '10',
        high_count: '30',
        medium_count: '40',
        low_count: '20',
        new_count: '20',
        reviewing_count: '15',
        in_progress_count: '30',
        resolved_count: '25',
        closed_count: '8',
        wont_fix_count: '2',
        recent_count: '40',
        avg_resolution_hours: '72.5',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [statsRow],
        rowCount: 1,
      } as any);

      const result = await service.getStats();

      expect(typeof result.total).toBe('number');
      expect(result.total).toBe(100);
      expect(result.avgResolutionTime).toBe(72.5);
    });

    it('should handle database errors when fetching stats', async () => {
      const dbError = new Error('Stats query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(service.getStats()).rejects.toThrow('Stats query failed');

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to get stats', {
        error: dbError,
        agentId: undefined,
      });
    });
  });

  describe('deleteFeedback', () => {
    it('should delete feedback by ID', async () => {
      mockPool.query.mockResolvedValueOnce({
        rowCount: 1,
      } as any);

      await service.deleteFeedback(testFeedbackId);

      expect(mockPool.query).toHaveBeenCalledWith(
        'DELETE FROM beta_feedback WHERE id = $1',
        [testFeedbackId]
      );
    });

    it('should handle case when feedback does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({
        rowCount: 0,
      } as any);

      // Should not throw, just silently succeed (common pattern for DELETE)
      await expect(service.deleteFeedback(testFeedbackId)).resolves.not.toThrow();
    });

    it('should handle database errors during deletion', async () => {
      const dbError = new Error('Delete failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(service.deleteFeedback(testFeedbackId)).rejects.toThrow('Delete failed');

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to delete feedback', {
        error: dbError,
        feedbackId: testFeedbackId,
      });
    });
  });

  describe('Error handling across all operations', () => {
    it('should log errors with proper context', async () => {
      const dbError = new Error('Connection lost');
      mockPool.query.mockRejectedValueOnce(dbError);

      const feedbackData: CreateFeedbackDto = {
        category: 'bug',
        severity: 'high',
        title: 'Test',
        description: 'Test',
      };

      try {
        await service.createFeedback(testAgentId, feedbackData);
      } catch (e) {
        // Error expected
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to create feedback',
        expect.objectContaining({
          error: dbError,
          agentId: testAgentId,
        })
      );
    });

    it('should not swallow errors', async () => {
      const originalError = new Error('Unique constraint violation');
      mockPool.query.mockRejectedValueOnce(originalError);

      const feedbackData: CreateFeedbackDto = {
        category: 'bug',
        severity: 'high',
        title: 'Test',
        description: 'Test',
      };

      const error = await service.createFeedback(testAgentId, feedbackData).catch((e) => e);

      expect(error).toBe(originalError);
      expect(error.message).toBe('Unique constraint violation');
    });
  });

  describe('Data mapping and transformation', () => {
    it('should correctly map database row to BetaFeedback object', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [mockFeedbackRow],
        rowCount: 1,
      } as any);

      const result = await service.getFeedbackById(testFeedbackId);

      expect(result).toEqual(
        expect.objectContaining({
          id: testFeedbackId,
          agentId: testAgentId,
          category: 'bug',
          severity: 'high',
          status: 'new',
          title: 'Test Feedback',
          description: 'Test feedback description',
          endpoint: '/api/test',
          httpMethod: 'GET',
          responseCode: 500,
          errorMessage: 'Internal Server Error',
          agentVersion: '1.0.0',
          sdkVersion: '2.0.0',
          userAgent: 'Mozilla/5.0',
          ipAddress: '192.168.1.1',
        })
      );
    });

    it('should correctly map database row to FeedbackComment object', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [mockCommentRow],
        rowCount: 1,
      } as any);

      const commentData: CreateFeedbackCommentDto = {
        comment: 'Test comment',
      };

      const result = await service.addComment(testFeedbackId, testAgentId, commentData);

      expect(result).toEqual(
        expect.objectContaining({
          id: testCommentId,
          feedbackId: testFeedbackId,
          agentId: testAgentId,
          comment: 'Test comment',
          isInternal: false,
        })
      );
    });

    it('should correctly map database row to BetaMetric object', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [mockMetricRow],
        rowCount: 1,
      } as any);

      const metricData: RecordMetricDto = {
        metricType: 'response_time',
        metricValue: 150,
        metadata: { extra: 'data' },
      };

      const result = await service.recordMetric(testAgentId, metricData);

      expect(result).toEqual(
        expect.objectContaining({
          id: testMetricId,
          agentId: testAgentId,
          metricType: 'response_time',
          metricValue: 150,
          metricUnit: 'ms',
          endpoint: '/api/test',
          operation: 'query',
        })
      );
    });

    it('should parse metadata JSON correctly', async () => {
      const metadataObject = { count: 10, duration: 1000, success: true };
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          ...mockMetricRow,
          metadata: JSON.stringify(metadataObject),
        }],
        rowCount: 1,
      } as any);

      const metricData: RecordMetricDto = {
        metricType: 'test_metric',
        metricValue: 100,
      };

      const result = await service.recordMetric(testAgentId, metricData);

      expect(result.metadata).toEqual(metadataObject);
      expect(result.metadata?.count).toBe(10);
      expect(result.metadata?.success).toBe(true);
    });
  });

  describe('Integration-like scenarios', () => {
    it('should handle complete feedback lifecycle', async () => {
      // Create feedback
      mockPool.query.mockResolvedValueOnce({
        rows: [mockFeedbackRow],
        rowCount: 1,
      } as any);

      const createData: CreateFeedbackDto = {
        category: 'bug',
        severity: 'high',
        title: 'Critical Issue',
        description: 'Something is broken',
      };

      const feedback = await service.createFeedback(testAgentId, createData);
      expect(feedback.status).toBe('new');

      // Add comments
      mockPool.query.mockResolvedValueOnce({
        rows: [mockCommentRow],
        rowCount: 1,
      } as any);

      const comment = await service.addComment(feedback.id, testAgentId, {
        comment: 'Investigating...',
      });
      expect(comment.id).toBe(testCommentId);

      // Update status
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockFeedbackRow, status: 'in_progress' }],
        rowCount: 1,
      } as any);

      const updated = await service.updateFeedback(feedback.id, {
        status: 'in_progress',
      });
      expect(updated.status).toBe('in_progress');

      // Resolve
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          ...mockFeedbackRow,
          status: 'resolved',
          resolution_notes: 'Fixed in v2.0',
          resolved_at: new Date(),
        }],
        rowCount: 1,
      } as any);

      const resolved = await service.updateFeedback(feedback.id, {
        status: 'resolved',
        resolutionNotes: 'Fixed in v2.0',
      });
      expect(resolved.status).toBe('resolved');

      // Delete
      mockPool.query.mockResolvedValueOnce({
        rowCount: 1,
      } as any);

      await service.deleteFeedback(feedback.id);
      expect(mockPool.query).toHaveBeenLastCalledWith(
        expect.stringContaining('DELETE'),
        [feedback.id]
      );
    });

    it('should generate correct statistics after operations', async () => {
      const statsRow = {
        total: 10,
        bug_count: 5,
        feature_count: 3,
        performance_count: 1,
        usability_count: 1,
        documentation_count: 0,
        other_count: 0,
        critical_count: 2,
        high_count: 4,
        medium_count: 3,
        low_count: 1,
        new_count: 3,
        reviewing_count: 2,
        in_progress_count: 3,
        resolved_count: 2,
        closed_count: 0,
        wont_fix_count: 0,
        recent_count: 6,
        avg_resolution_hours: 36.0,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [statsRow],
        rowCount: 1,
      } as any);

      const stats = await service.getStats(testAgentId);

      expect(stats.total).toBe(10);
      expect(stats.byCategory.bug).toBe(5);
      expect(stats.byCategory.feature).toBe(3);
      expect(stats.bySeverity.critical).toBe(2);
      expect(stats.bySeverity.high).toBe(4);
      expect(stats.byStatus.new).toBe(3);
      expect(stats.byStatus.in_progress).toBe(3);
      expect(stats.recentCount).toBe(6);
    });
  });
});
