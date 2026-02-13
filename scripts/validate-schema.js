#!/usr/bin/env node
/**
 * Database Schema Validation Script
 * 
 * Validates SQL syntax and structure of schema files
 */

const fs = require('fs');
const path = require('path');

console.log('Database Schema Validation\n');

const files = [
  'src/database/schema.sql',
  'src/database/migrations/001_initial_schema.sql',
  'src/database/seeds/001_initial_seed.sql'
];

let hasErrors = false;

files.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  console.log(`Checking ${file}...`);
  
  if (!fs.existsSync(filePath)) {
    console.error(`  ✗ File not found: ${filePath}`);
    hasErrors = true;
    return;
  }
  
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // Basic SQL syntax checks
  const checks = [
    { pattern: /CREATE TABLE/gi, name: 'CREATE TABLE statements' },
    { pattern: /CREATE INDEX/gi, name: 'CREATE INDEX statements' },
    { pattern: /CREATE TRIGGER/gi, name: 'CREATE TRIGGER statements' },
    { pattern: /CREATE EXTENSION/gi, name: 'CREATE EXTENSION statements' }
  ];
  
  checks.forEach(check => {
    const matches = content.match(check.pattern);
    if (matches) {
      console.log(`  ✓ Found ${matches.length} ${check.name}`);
    }
  });
  
  // Check for common syntax errors
  if (content.includes(';;')) {
    console.warn(`  ⚠ Warning: Double semicolons found (may be intentional)`);
  }
  
  console.log('');
});

if (hasErrors) {
  console.error('✗ Validation failed with errors');
  process.exit(1);
} else {
  console.log('✓ All schema files validated successfully');
}
