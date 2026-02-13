/**
 * Database Schema Integration Tests
 * 
 * Tests the database schema, migrations, and seed data
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

describe('Database Schema', () => {
  let pool: Pool | null = null;
  let dbAvailable = false;

  beforeAll(async () => {
    // Use a test database URL or default
    const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    
    if (!DATABASE_URL) {
      console.warn('No database URL configured, skipping integration tests');
      return;
    }

    try {
      pool = new Pool({ connectionString: DATABASE_URL });
      // Test connection
      await pool.query('SELECT 1');
      dbAvailable = true;
    } catch (error) {
      console.warn('Database not available, skipping integration tests:', error);
      pool = null;
      dbAvailable = false;
    }
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  describe('Schema SQL Files', () => {
    it('should have valid schema.sql file', () => {
      const schemaPath = path.join(__dirname, '..', '..', 'src', 'database', 'schema.sql');
      expect(fs.existsSync(schemaPath)).toBe(true);
      
      const content = fs.readFileSync(schemaPath, 'utf-8');
      expect(content).toContain('CREATE TABLE');
      expect(content).toContain('agents');
      expect(content).toContain('forums');
      expect(content).toContain('posts');
      expect(content).toContain('comments');
      expect(content).toContain('votes');
      expect(content).toContain('audit_logs');
    });

    it('should have migration files', () => {
      const migrationsDir = path.join(__dirname, '..', '..', 'src', 'database', 'migrations');
      expect(fs.existsSync(migrationsDir)).toBe(true);
      
      const files = fs.readdirSync(migrationsDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files[0]).toMatch(/^\d+_.+\.sql$/);
    });

    it('should have seed files', () => {
      const seedsDir = path.join(__dirname, '..', '..', 'src', 'database', 'seeds');
      expect(fs.existsSync(seedsDir)).toBe(true);
      
      const files = fs.readdirSync(seedsDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files[0]).toMatch(/^\d+_.+\.sql$/);
    });
  });

  describe('Database Tables', () => {
    // Skip if no database connection
    const skipIfNoDb = () => {
      if (!dbAvailable || !pool) {
        console.warn('Skipping database tests - no connection');
        return true;
      }
      return false;
    };

    it('should have all required tables', async () => {
      if (skipIfNoDb()) return;

      const result = await pool!.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);

      const tables = result.rows.map(row => row.table_name);
      
      // Check for all required tables
      const requiredTables = [
        'agents',
        'forums',
        'posts',
        'comments',
        'votes',
        'audit_logs',
        'agent_subscriptions'
      ];

      requiredTables.forEach(table => {
        expect(tables).toContain(table);
      });
    });

    it('should have agents table with correct columns', async () => {
      if (skipIfNoDb()) return;

      const result = await pool!.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'agents'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map(row => row.column_name);
      
      expect(columns).toContain('id');
      expect(columns).toContain('name');
      expect(columns).toContain('api_key_hash');
      expect(columns).toContain('created_at');
      expect(columns).toContain('updated_at');
      expect(columns).toContain('reputation_score');
    });

    it('should have proper indexes', async () => {
      if (skipIfNoDb()) return;

      const result = await pool!.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY indexname
      `);

      const indexes = result.rows.map(row => row.indexname);
      
      // Check for some key indexes
      expect(indexes.some(idx => idx.includes('agents'))).toBe(true);
      expect(indexes.some(idx => idx.includes('forums'))).toBe(true);
      expect(indexes.some(idx => idx.includes('posts'))).toBe(true);
    });

    it('should have proper foreign key constraints', async () => {
      if (skipIfNoDb()) return;

      const result = await pool!.query(`
        SELECT
          tc.table_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
        ORDER BY tc.table_name
      `);

      // Check for key foreign key relationships
      const fks = result.rows.map(row => ({
        table: row.table_name,
        column: row.column_name,
        foreign_table: row.foreign_table_name
      }));

      // Forums should reference agents
      expect(fks.some(fk => 
        fk.table === 'forums' && 
        fk.column === 'creator_id' && 
        fk.foreign_table === 'agents'
      )).toBe(true);

      // Posts should reference forums and agents
      expect(fks.some(fk => 
        fk.table === 'posts' && 
        fk.column === 'forum_id' && 
        fk.foreign_table === 'forums'
      )).toBe(true);
    });

    it('should have triggers for updated_at', async () => {
      if (skipIfNoDb()) return;

      const result = await pool!.query(`
        SELECT trigger_name, event_object_table
        FROM information_schema.triggers
        WHERE trigger_schema = 'public'
        ORDER BY event_object_table
      `);

      const triggers = result.rows.map(row => ({
        name: row.trigger_name,
        table: row.event_object_table
      }));

      // Check for updated_at triggers on key tables
      const tablesWithTriggers = ['agents', 'forums', 'posts', 'comments'];
      
      tablesWithTriggers.forEach(table => {
        expect(triggers.some(t => t.table === table)).toBe(true);
      });
    });
  });

  describe('Database Extensions', () => {
    it('should have uuid-ossp extension', async () => {
      if (!dbAvailable || !pool) {
        console.warn('Skipping - no database connection');
        return;
      }

      const result = await pool!.query(`
        SELECT * FROM pg_extension WHERE extname = 'uuid-ossp'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should have pg_trgm extension for text search', async () => {
      if (!dbAvailable || !pool) {
        console.warn('Skipping - no database connection');
        return;
      }

      const result = await pool!.query(`
        SELECT * FROM pg_extension WHERE extname = 'pg_trgm'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });
  });
});
