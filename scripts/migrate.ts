#!/usr/bin/env node
/**
 * Database Migration Script
 * 
 * Applies SQL migrations from src/database/migrations directory
 * Usage: npm run db:migrate
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://moltbook_user:moltbook_password@localhost:5432/moltbook';

interface MigrationRecord {
  id: number;
  version: string;
  name: string;
  applied_at: Date;
}

/**
 * Create migrations tracking table if it doesn't exist
 */
async function createMigrationsTable(pool: Pool): Promise<void> {
  const query = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;
  
  await pool.query(query);
  console.log('✓ Migrations table ready');
}

/**
 * Get list of applied migrations
 */
async function getAppliedMigrations(pool: Pool): Promise<string[]> {
  const result = await pool.query<MigrationRecord>(
    'SELECT version FROM schema_migrations ORDER BY version ASC'
  );
  return result.rows.map(row => row.version);
}

/**
 * Get list of migration files from filesystem
 */
function getMigrationFiles(): { version: string; name: string; path: string }[] {
  const migrationsDir = path.join(__dirname, '..', 'src', 'database', 'migrations');
  
  if (!fs.existsSync(migrationsDir)) {
    console.error(`Migrations directory not found: ${migrationsDir}`);
    return [];
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  return files.map(file => {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) {
      throw new Error(`Invalid migration filename format: ${file}`);
    }
    
    return {
      version: match[1],
      name: match[2],
      path: path.join(migrationsDir, file)
    };
  });
}

/**
 * Apply a single migration
 */
async function applyMigration(
  pool: Pool,
  migration: { version: string; name: string; path: string }
): Promise<void> {
  console.log(`\nApplying migration ${migration.version}: ${migration.name}`);
  
  const sql = fs.readFileSync(migration.path, 'utf-8');
  
  // Execute migration in a transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Apply the migration
    await client.query(sql);
    
    // Record the migration
    await client.query(
      'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
      [migration.version, migration.name]
    );
    
    await client.query('COMMIT');
    console.log(`✓ Migration ${migration.version} applied successfully`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Main migration function
 */
async function runMigrations(): Promise<void> {
  console.log('Starting database migrations...\n');
  console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}\n`);

  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✓ Database connection established\n');

    // Create migrations table
    await createMigrationsTable(pool);

    // Get applied migrations
    const appliedMigrations = await getAppliedMigrations(pool);
    console.log(`Applied migrations: ${appliedMigrations.length}\n`);

    // Get migration files
    const migrationFiles = getMigrationFiles();
    console.log(`Migration files found: ${migrationFiles.length}\n`);

    // Apply pending migrations
    let appliedCount = 0;
    for (const migration of migrationFiles) {
      if (!appliedMigrations.includes(migration.version)) {
        await applyMigration(pool, migration);
        appliedCount++;
      } else {
        console.log(`⊘ Migration ${migration.version} already applied`);
      }
    }

    console.log(`\n✓ Migration complete! Applied ${appliedCount} new migration(s)`);
  } catch (error) {
    console.error('\n✗ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

/**
 * Rollback last migration (optional feature)
 */
async function rollbackMigration(): Promise<void> {
  console.log('Rollback functionality not yet implemented');
  console.log('Please manually revert changes if needed');
  process.exit(1);
}

// Run migrations
if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'rollback') {
    rollbackMigration().catch(console.error);
  } else {
    runMigrations().catch(console.error);
  }
}

export { runMigrations, rollbackMigration };
