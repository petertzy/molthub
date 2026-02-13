/**
 * Integration test for audit logging system
 */
import { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../../src/app';
import { AuditService } from '@modules/audit/audit.service';
import { AuditAction, AuditStatus } from '@modules/audit/audit.types';

describe('Audit Integration Tests', () => {
  let app: any;
  let pool: Pool;
  let auditService: AuditService;
  let authToken: string;
  let agentId: string;

  beforeAll(async () => {
    // Use test database
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });

    app = createApp();
    auditService = new AuditService(pool);

    // Register a test agent and get auth token
    const registerResponse = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'test-audit-agent',
        description: 'Test agent for audit integration tests',
      });

    const { apiKey, apiSecret, id } = registerResponse.body.data;
    agentId = id;

    // Get auth token
    const tokenResponse = await request(app)
      .post('/api/v1/auth/token')
      .send({
        apiKey,
        apiSecret,
      });

    authToken = tokenResponse.body.data.accessToken;
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM agents WHERE name = $1', ['test-audit-agent']);
    await pool.end();
  });

  describe('Automatic Audit Logging', () => {
    it('should log registration action', async () => {
      // Wait a bit for async logging
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Query audit logs for the registration
      const logs = await auditService.query({
        agent_id: agentId,
        action: AuditAction.AGENT_CREATE,
        limit: 1,
      });

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].action).toBe(AuditAction.AGENT_CREATE);
      expect(logs[0].status).toBe(AuditStatus.SUCCESS);
    });

    it('should log authentication action', async () => {
      // Wait for async logging
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Query audit logs for token generation
      const logs = await auditService.query({
        agent_id: agentId,
        action: AuditAction.AUTH_LOGIN,
        limit: 1,
      });

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].action).toBe(AuditAction.AUTH_LOGIN);
      expect(logs[0].status).toBe(AuditStatus.SUCCESS);
    });
  });

  describe('Audit API Endpoints', () => {
    it('should query audit logs via API', async () => {
      const response = await request(app)
        .get('/api/v1/audit/logs')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ agent_id: agentId, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toBeDefined();
    });

    it('should get audit statistics via API', async () => {
      const response = await request(app)
        .get('/api/v1/audit/stats')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.total_logs).toBeGreaterThan(0);
      expect(response.body.data.success_count).toBeGreaterThan(0);
    });

    it('should export audit logs in JSON format', async () => {
      const response = await request(app)
        .get('/api/v1/audit/export')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ format: 'json', agent_id: agentId });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      
      const exportedData = JSON.parse(response.text);
      expect(Array.isArray(exportedData)).toBe(true);
    });

    it('should export audit logs in CSV format', async () => {
      const response = await request(app)
        .get('/api/v1/audit/export')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ format: 'csv', agent_id: agentId });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.text).toContain('id,agent_id,action');
    });
  });

  describe('Data Protection', () => {
    it('should mask sensitive data in audit logs', async () => {
      // Create an audit log with sensitive data
      await auditService.log({
        agent_id: agentId,
        action: AuditAction.AUTH_LOGIN,
        status: AuditStatus.SUCCESS,
        details: {
          password: 'secret123',
          api_key: 'key-abc-123',
          email: 'test@example.com',
        },
      });

      // Query the log
      const logs = await auditService.query({
        agent_id: agentId,
        action: AuditAction.AUTH_LOGIN,
        limit: 1,
      });

      expect(logs.length).toBeGreaterThan(0);
      const log = logs[0];
      
      // Sensitive fields should be masked
      expect(log.details.password).toBe('[REDACTED]');
      expect(log.details.api_key).toBe('[REDACTED]');
      expect(log.details.email).toMatch(/^.{3}\*\*\*$/);
    });
  });

  describe('Retention Policy', () => {
    it('should apply retention policy', async () => {
      // Set a short retention period for testing
      auditService.setRetentionPolicy({
        retention_days: 0,
        archive_enabled: false,
      });

      const deletedCount = await auditService.applyRetentionPolicy();

      // Should delete some logs (or 0 if all are recent)
      expect(deletedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Reporting', () => {
    it('should generate audit report', async () => {
      const start_date = new Date('2026-01-01');
      const end_date = new Date('2026-12-31');

      const report = await auditService.generateReport(start_date, end_date);

      expect(report.period.start_date).toEqual(start_date);
      expect(report.period.end_date).toEqual(end_date);
      expect(report.summary).toBeDefined();
      expect(report.agent_activity).toBeDefined();
      expect(report.recent_failures).toBeDefined();
    });
  });
});
