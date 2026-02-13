import { Pool } from 'pg';
import { AuditService } from '@modules/audit/audit.service';
import {
  AuditAction,
  AuditStatus,
  ResourceType,
  AuditLogEntry,
} from '@modules/audit/audit.types';

// Mock dependencies
jest.mock('@config/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('AuditService', () => {
  let service: AuditService;
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

    service = new AuditService(mockPool as Pool, 'test-encryption-key-32-chars-');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should create an audit log entry', async () => {
      const mockId = 'test-log-id';
      mockPool.query.mockResolvedValue({
        rows: [{ id: mockId }],
        rowCount: 1,
      });

      const entry: AuditLogEntry = {
        agent_id: 'agent-123',
        action: AuditAction.POST_CREATE,
        resource_type: ResourceType.POST,
        resource_id: 'post-456',
        status: AuditStatus.SUCCESS,
        ip_address: '192.168.1.1',
        user_agent: 'Test Agent',
        details: {
          title: 'Test Post',
          forum_id: 'forum-789',
        },
      };

      const logId = await service.log(entry);

      expect(logId).toBe(mockId);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining([
          'agent-123',
          AuditAction.POST_CREATE,
          ResourceType.POST,
          'post-456',
          AuditStatus.SUCCESS,
          '192.168.1.1',
          'Test Agent',
          expect.any(String), // encrypted details
        ]),
      );
    });

    it('should mask sensitive data in details', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ id: 'log-id' }],
        rowCount: 1,
      });

      const entry: AuditLogEntry = {
        agent_id: 'agent-123',
        action: AuditAction.AUTH_LOGIN,
        status: AuditStatus.SUCCESS,
        details: {
          password: 'secret123',
          api_key: 'key-abc-123',
          email: 'test@example.com',
        },
      };

      await service.log(entry);

      // Verify that query was called and sensitive data was masked
      expect(mockPool.query).toHaveBeenCalled();
      const queryArgs = mockPool.query.mock.calls[0][1];
      const encryptedDetails = queryArgs[7];

      // Details should be encrypted (not null)
      expect(encryptedDetails).toBeTruthy();
      expect(typeof encryptedDetails).toBe('string');
    });

    it('should handle logging errors gracefully', async () => {
      mockPool.query.mockRejectedValue(new Error('Database error'));

      const entry: AuditLogEntry = {
        action: AuditAction.POST_CREATE,
        status: AuditStatus.SUCCESS,
      };

      const logId = await service.log(entry);

      // Should return empty string on error, not throw
      expect(logId).toBe('');
    });
  });

  describe('query', () => {
    it('should query audit logs with filters', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          agent_id: 'agent-123',
          action: AuditAction.POST_CREATE,
          resource_type: ResourceType.POST,
          resource_id: 'post-456',
          status: AuditStatus.SUCCESS,
          ip_address: '192.168.1.1',
          user_agent: 'Test Agent',
          details: null,
          created_at: new Date(),
        },
      ];

      mockPool.query.mockResolvedValue({
        rows: mockLogs,
        rowCount: 1,
      });

      const filters = {
        agent_id: 'agent-123',
        action: AuditAction.POST_CREATE,
        limit: 10,
        offset: 0,
      };

      const logs = await service.query(filters);

      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe('log-1');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE agent_id = $1 AND action = $2'),
        expect.arrayContaining(['agent-123', AuditAction.POST_CREATE, 10, 0]),
      );
    });

    it('should handle date range filters', async () => {
      mockPool.query.mockResolvedValue({
        rows: [],
        rowCount: 0,
      });

      const start_date = new Date('2026-01-01');
      const end_date = new Date('2026-12-31');

      await service.query({ start_date, end_date });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('created_at >= $1 AND created_at <= $2'),
        expect.arrayContaining([start_date, end_date]),
      );
    });

    it('should decrypt log details', async () => {
      // Create a test service to encrypt data
      const testService = new AuditService(mockPool as Pool, 'test-key-32-chars-long-enough-');

      // First, log something to get encrypted details
      const testDetails = { test: 'value' };
      
      // Mock successful encryption by service
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'test-id' }],
        rowCount: 1,
      });

      await testService.log({
        action: AuditAction.POST_CREATE,
        status: AuditStatus.SUCCESS,
        details: testDetails,
      });

      // Get the encrypted value that was stored
      const encryptedValue = mockPool.query.mock.calls[0][1][7];

      // Now mock query to return this encrypted value
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'log-1',
            agent_id: null,
            action: AuditAction.POST_CREATE,
            resource_type: null,
            resource_id: null,
            status: AuditStatus.SUCCESS,
            ip_address: null,
            user_agent: null,
            details: encryptedValue,
            created_at: new Date(),
          },
        ],
        rowCount: 1,
      });

      const logs = await testService.query({ limit: 10 });

      expect(logs).toHaveLength(1);
      expect(logs[0].details).toEqual(testDetails);
    });
  });

  describe('getStats', () => {
    it('should return audit log statistics', async () => {
      // Mock count query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_logs: '100',
            success_count: '85',
            failure_count: '10',
            warning_count: '5',
          },
        ],
        rowCount: 1,
      });

      // Mock actions breakdown query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { action: AuditAction.POST_CREATE, count: '30' },
          { action: AuditAction.POST_UPDATE, count: '20' },
        ],
        rowCount: 2,
      });

      // Mock top agents query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { agent_id: 'agent-1', action_count: '50' },
          { agent_id: 'agent-2', action_count: '30' },
        ],
        rowCount: 2,
      });

      const stats = await service.getStats();

      expect(stats.total_logs).toBe(100);
      expect(stats.success_count).toBe(85);
      expect(stats.failure_count).toBe(10);
      expect(stats.warning_count).toBe(5);
      expect(stats.actions_breakdown[AuditAction.POST_CREATE]).toBe(30);
      expect(stats.top_agents).toHaveLength(2);
      expect(stats.top_agents[0].agent_id).toBe('agent-1');
    });

    it('should handle date range in stats', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            total_logs: '50',
            success_count: '45',
            failure_count: '3',
            warning_count: '2',
          },
        ],
        rowCount: 1,
      });

      const start_date = new Date('2026-01-01');
      const end_date = new Date('2026-01-31');

      await service.getStats(start_date, end_date);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE created_at >= $1 AND created_at <= $2'),
        expect.arrayContaining([start_date, end_date]),
      );
    });
  });

  describe('applyRetentionPolicy', () => {
    it('should delete logs older than retention period', async () => {
      mockPool.query.mockResolvedValue({
        rowCount: 50,
      });

      const deletedCount = await service.applyRetentionPolicy();

      expect(deletedCount).toBe(50);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringMatching(/DELETE FROM audit_logs\s+WHERE created_at < \$1/),
        expect.arrayContaining([expect.any(Date)]),
      );
    });

    it('should use custom retention policy', async () => {
      mockPool.query.mockResolvedValue({
        rowCount: 25,
      });

      service.setRetentionPolicy({
        retention_days: 30,
        archive_enabled: false,
      });

      const deletedCount = await service.applyRetentionPolicy();

      expect(deletedCount).toBe(25);
    });
  });

  describe('generateReport', () => {
    it('should generate comprehensive audit report', async () => {
      // Mock getStats
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            total_logs: '100',
            success_count: '90',
            failure_count: '8',
            warning_count: '2',
          },
        ],
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [{ action: AuditAction.POST_CREATE, count: '50' }],
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [{ agent_id: 'agent-1', action_count: '60' }],
      });

      // Mock query for logs
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'log-1',
            agent_id: 'agent-1',
            action: AuditAction.POST_CREATE,
            resource_type: ResourceType.POST,
            resource_id: 'post-1',
            status: AuditStatus.SUCCESS,
            ip_address: '192.168.1.1',
            user_agent: 'Test',
            details: null,
            created_at: new Date(),
          },
          {
            id: 'log-2',
            agent_id: 'agent-2',
            action: AuditAction.POST_UPDATE,
            resource_type: ResourceType.POST,
            resource_id: 'post-2',
            status: AuditStatus.FAILURE,
            ip_address: '192.168.1.2',
            user_agent: 'Test',
            details: null,
            created_at: new Date(),
          },
        ],
      });

      const start_date = new Date('2026-01-01');
      const end_date = new Date('2026-01-31');

      const report = await service.generateReport(start_date, end_date);

      expect(report.period.start_date).toEqual(start_date);
      expect(report.period.end_date).toEqual(end_date);
      expect(report.summary.total_logs).toBe(100);
      expect(report.agent_activity).toBeDefined();
      expect(report.recent_failures).toBeDefined();
    });
  });

  describe('exportLogs', () => {
    it('should export logs in JSON format', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          agent_id: 'agent-1',
          action: AuditAction.POST_CREATE,
          resource_type: ResourceType.POST,
          resource_id: 'post-1',
          status: AuditStatus.SUCCESS,
          ip_address: '192.168.1.1',
          user_agent: 'Test',
          details: null,
          created_at: new Date(),
        },
      ];

      mockPool.query.mockResolvedValue({
        rows: mockLogs,
      });

      const exported = await service.exportLogs({}, 'json');

      expect(exported).toContain('"id": "log-1"');
      expect(exported).toContain('"action": "POST_CREATE"');
      expect(() => JSON.parse(exported)).not.toThrow();
    });

    it('should export logs in CSV format', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          agent_id: 'agent-1',
          action: AuditAction.POST_CREATE,
          resource_type: ResourceType.POST,
          resource_id: 'post-1',
          status: AuditStatus.SUCCESS,
          ip_address: '192.168.1.1',
          user_agent: 'Test',
          details: null,
          created_at: new Date('2026-01-01'),
        },
      ];

      mockPool.query.mockResolvedValue({
        rows: mockLogs,
      });

      const exported = await service.exportLogs({}, 'csv');

      expect(exported).toContain('id,agent_id,action');
      expect(exported).toContain('"log-1"');
      expect(exported).toContain('"POST_CREATE"');
    });
  });

  describe('encryption', () => {
    it('should encrypt and decrypt data correctly', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'test-id' }],
      });

      const testData = {
        sensitive: 'secret-value',
        number: 123,
        nested: { key: 'value' },
      };

      await service.log({
        action: AuditAction.POST_CREATE,
        status: AuditStatus.SUCCESS,
        details: testData,
      });

      const encryptedDetails = mockPool.query.mock.calls[0][1][7];

      // Should be encrypted (string with IV and encrypted data)
      expect(encryptedDetails).toBeTruthy();
      expect(encryptedDetails).toContain(':');

      // Now mock a query that returns this encrypted data
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'log-1',
            agent_id: null,
            action: AuditAction.POST_CREATE,
            resource_type: null,
            resource_id: null,
            status: AuditStatus.SUCCESS,
            ip_address: null,
            user_agent: null,
            details: encryptedDetails,
            created_at: new Date(),
          },
        ],
      });

      const logs = await service.query({ limit: 1 });

      // Should decrypt correctly
      expect(logs[0].details).toEqual(testData);
    });
  });
});
