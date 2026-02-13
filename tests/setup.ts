// Test setup file
// This file runs before all tests

// Set test environment variables BEFORE any imports
process.env.NODE_ENV = 'development'; // Must be valid enum value
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://moltbook_user:moltbook_password@localhost:5432/moltbook';
process.env.JWT_SECRET = 'test-jwt-secret-min-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-min-32-chars';
process.env.JWT_EXPIRATION = '3600';
process.env.JWT_REFRESH_EXPIRATION = '604800';
process.env.LOG_LEVEL = 'error'; // Reduce log noise in tests

// Set test timeout
jest.setTimeout(30000); // 30 seconds for integration tests

