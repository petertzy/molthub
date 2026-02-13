/**
 * Test Database Utilities
 * 
 * Provides utilities for setting up and tearing down test databases
 * to ensure isolation between integration tests.
 */

import { Pool, PoolConfig } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Create a test database pool
 */
export async function createTestPool(): Promise<Pool> {
  const config: PoolConfig = {
    connectionString: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
    min: 1,
    max: 5,
  };

  const pool = new Pool(config);

  // Test connection
  try {
    await pool.query('SELECT 1');
    console.log('✓ Test database connection established');
  } catch (error) {
    console.error('✗ Failed to connect to test database:', error);
    throw error;
  }

  return pool;
}

/**
 * Set up test database schema
 */
export async function setupTestDatabase(pool: Pool): Promise<void> {
  const schemaPath = path.join(__dirname, '../../src/database/schema.sql');
  
  if (!fs.existsSync(schemaPath)) {
    console.warn('⚠ Schema file not found, skipping schema setup');
    return;
  }

  try {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);
    console.log('✓ Test database schema created');
  } catch (error) {
    console.error('✗ Failed to set up test database schema:', error);
    throw error;
  }
}

/**
 * Clean up all tables in the test database
 */
export async function cleanupTestDatabase(pool: Pool): Promise<void> {
  const tables = [
    'votes',
    'comment_edit_history',
    'comments',
    'post_edit_history',
    'posts',
    'forum_subscriptions',
    'forums',
    'agents',
  ];

  try {
    // Disable foreign key checks temporarily
    await pool.query('SET session_replication_role = replica;');

    // Truncate all tables
    for (const table of tables) {
      await pool.query(`TRUNCATE TABLE ${table} CASCADE`);
    }

    // Re-enable foreign key checks
    await pool.query('SET session_replication_role = DEFAULT;');

    console.log('✓ Test database cleaned up');
  } catch (error) {
    console.error('✗ Failed to clean up test database:', error);
    throw error;
  }
}

/**
 * Seed test database with minimal data
 */
export async function seedTestDatabase(pool: Pool): Promise<void> {
  try {
    // Insert a test agent
    await pool.query(`
      INSERT INTO agents (
        id, name, api_key_hash, api_secret_hash, created_at, updated_at
      ) VALUES (
        '00000000-0000-0000-0000-000000000001',
        'TestAgent',
        'test_hash',
        'test_secret_hash',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      ) ON CONFLICT (id) DO NOTHING
    `);

    // Insert a test forum
    await pool.query(`
      INSERT INTO forums (
        id, name, slug, description, created_at, updated_at
      ) VALUES (
        '00000000-0000-0000-0000-000000000001',
        'Test Forum',
        'test-forum',
        'A forum for testing',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      ) ON CONFLICT (id) DO NOTHING
    `);

    console.log('✓ Test database seeded');
  } catch (error) {
    console.error('✗ Failed to seed test database:', error);
    throw error;
  }
}

/**
 * Close test database pool
 */
export async function closeTestPool(pool: Pool): Promise<void> {
  try {
    await pool.end();
    console.log('✓ Test database connection closed');
  } catch (error) {
    console.error('✗ Failed to close test database connection:', error);
    throw error;
  }
}

/**
 * Helper to run tests with database isolation
 */
export async function withTestDatabase<T>(
  testFn: (pool: Pool) => Promise<T>
): Promise<T> {
  const pool = await createTestPool();

  try {
    await setupTestDatabase(pool);
    await cleanupTestDatabase(pool);
    await seedTestDatabase(pool);

    const result = await testFn(pool);

    return result;
  } finally {
    await cleanupTestDatabase(pool);
    await closeTestPool(pool);
  }
}
