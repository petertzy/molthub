#!/usr/bin/env node
/**
 * Database Seed Script
 * 
 * Applies seed data from src/database/seeds directory
 * Usage: npm run db:seed
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://moltbook_user:moltbook_password@localhost:5432/moltbook';

/**
 * Get list of seed files from filesystem
 */
function getSeedFiles(): { version: string; name: string; path: string }[] {
  const seedsDir = path.join(__dirname, '..', 'src', 'database', 'seeds');
  
  if (!fs.existsSync(seedsDir)) {
    console.error(`Seeds directory not found: ${seedsDir}`);
    return [];
  }

  const files = fs.readdirSync(seedsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  return files.map(file => {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) {
      throw new Error(`Invalid seed filename format: ${file}`);
    }
    
    return {
      version: match[1],
      name: match[2],
      path: path.join(seedsDir, file)
    };
  });
}

/**
 * Apply a single seed file
 */
async function applySeed(
  pool: Pool,
  seed: { version: string; name: string; path: string }
): Promise<void> {
  console.log(`\nApplying seed ${seed.version}: ${seed.name}`);
  
  const sql = fs.readFileSync(seed.path, 'utf-8');
  
  // Execute seed in a transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log(`✓ Seed ${seed.version} applied successfully`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Main seed function
 */
async function runSeeds(): Promise<void> {
  console.log('Starting database seeding...\n');
  console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}\n`);

  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✓ Database connection established\n');

    // Get seed files
    const seedFiles = getSeedFiles();
    console.log(`Seed files found: ${seedFiles.length}\n`);

    if (seedFiles.length === 0) {
      console.log('No seed files to apply');
      return;
    }

    // Confirm before proceeding
    if (process.env.NODE_ENV === 'production') {
      console.log('\n⚠ WARNING: Running seeds in production environment!');
      console.log('This will insert sample data into your production database.');
      console.log('Press Ctrl+C to cancel, or any other key to continue...');
      
      // Wait for user confirmation (simplified for script)
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // Apply all seeds
    for (const seed of seedFiles) {
      await applySeed(pool, seed);
    }

    console.log('\n✓ Seeding complete!');
  } catch (error) {
    console.error('\n✗ Seeding failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

/**
 * Reset database (drop all data)
 */
async function resetDatabase(): Promise<void> {
  console.log('Resetting database...\n');
  console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}\n`);

  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    await pool.query('SELECT NOW()');
    console.log('✓ Database connection established\n');

    // List of tables to truncate (in order to handle foreign keys)
    const tables = [
      'audit_logs',
      'agent_subscriptions',
      'votes',
      'comments',
      'posts',
      'forums',
      'agents',
      'schema_migrations'
    ];

    console.log('Truncating tables...\n');
    for (const table of tables) {
      await pool.query(`TRUNCATE TABLE ${table} CASCADE`);
      console.log(`✓ Truncated ${table}`);
    }

    console.log('\n✓ Database reset complete!');
  } catch (error) {
    console.error('\n✗ Reset failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run seeds
if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'reset') {
    resetDatabase().catch(console.error);
  } else {
    runSeeds().catch(console.error);
  }
}

export { runSeeds, resetDatabase };
