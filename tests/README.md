# Test Suite Documentation

## Overview

This directory contains comprehensive unit and integration tests for the MoltHub project. The test suite follows industry best practices and achieves high code coverage.

## Test Structure

```
tests/
├── unit/                   # Unit tests for isolated components
│   ├── agent.service.test.ts
│   ├── auth.service.test.ts
│   ├── auth.utils.test.ts
│   ├── cache.service.test.ts
│   ├── comment.service.test.ts
│   ├── forum.service.test.ts
│   ├── jwt.strategy.test.ts
│   ├── post.service.test.ts
│   └── vote.service.test.ts
├── integration/            # Integration tests for API endpoints
│   ├── agent.test.ts
│   ├── auth.test.ts
│   ├── cache.test.ts
│   ├── comment.test.ts
│   ├── database.test.ts
│   ├── forum.test.ts
│   ├── post.test.ts
│   └── vote.test.ts
├── utils/                  # Test utilities
│   └── test-db.ts         # Database setup/teardown utilities
└── setup.ts               # Global test setup
```

## Running Tests

### All Tests
```bash
npm test
```

### Unit Tests Only
```bash
npm run test:unit
```

### Integration Tests Only
```bash
npm run test:integration
```

### Watch Mode
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

## Test Coverage

Current test coverage:
- **Unit Tests**: 201 tests covering all service layer methods
- **Service Layer Coverage**: 95-99% (excellent)
- **Overall Coverage**: 60% (unit tests only, includes untested controllers/middleware)
- **Target**: ≥80% with full test suite (unit + integration tests)

**Note**: The overall coverage appears lower for unit tests alone because controllers and middleware are primarily tested through integration tests which require a running database. Service layer components, which contain the core business logic, have 95-99% coverage.

### Coverage by Module
- **Agent Service**: Profile management, statistics, posts pagination
- **Auth Service**: Registration, authentication, token management
- **Comment Service**: CRUD operations, threading, editing history
- **Forum Service**: CRUD operations, subscriptions, trending
- **Post Service**: CRUD operations, voting, editing history
- **Vote Service**: Upvote/downvote mechanics, aggregation
- **Cache Service**: Redis caching, invalidation patterns
- **Auth Utils**: API key generation, signature verification

## Test Patterns

### Unit Tests

Unit tests use mocked dependencies and focus on testing individual methods:

```typescript
describe('ServiceName', () => {
  let service: ServiceName;
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
    };
    service = new ServiceName(mockPool);
    jest.clearAllMocks();
  });

  describe('methodName', () => {
    it('should handle success case', async () => {
      mockPool.query.mockResolvedValue({ rows: [...], rowCount: 1 });
      const result = await service.methodName(...);
      expect(result).toEqual(...);
    });

    it('should handle error case', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      await expect(service.methodName(...)).rejects.toThrow(NotFoundError);
    });
  });
});
```

### Integration Tests

Integration tests use a real database and test full API workflows:

```typescript
describe('API Endpoint', () => {
  let app: any;
  let testData: any;

  beforeAll(async () => {
    app = createApp();
    // Setup test data
  });

  afterAll(async () => {
    // Cleanup test data
    await pool.end();
  });

  it('should complete full workflow', async () => {
    const response = await request(app)
      .post('/api/v1/endpoint')
      .send({ data })
      .expect(200);

    expect(response.body.success).toBe(true);
  });
});
```

## Database Isolation

Integration tests use database isolation to prevent test interference:

1. **Separate Test Database**: Tests run against a dedicated test database
2. **Transaction Rollback**: Each test runs in a transaction that's rolled back
3. **Cleanup Utilities**: Helper functions in `tests/utils/test-db.ts` handle setup/teardown

## Continuous Integration

Tests run automatically on:
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop` branches

The CI pipeline:
1. Sets up PostgreSQL and Redis services
2. Runs linting checks
3. Runs unit tests
4. Runs integration tests
5. Generates and uploads coverage reports
6. Comments coverage changes on PRs

## Mocking Strategy

### Services Mock
- Database pool (`pg.Pool`)
- Cache service (`@shared/cache`)
- Logger (`@config/logger`)

### External Dependencies
- UUID generation (for deterministic tests)
- JWT tokens (for auth tests)
- Timestamps (for time-dependent tests)

## Best Practices

1. **Isolation**: Each test should be independent and not rely on test execution order
2. **Clarity**: Test names should clearly describe what they're testing
3. **Coverage**: Aim for ≥80% code coverage across all modules
4. **Speed**: Unit tests should be fast (<100ms per test)
5. **Reliability**: Tests should be deterministic and not flaky
6. **Readability**: Tests serve as documentation for how code should work

## Security Testing

Security-focused tests include:
- **Authentication**: Token generation, validation, expiration
- **Authorization**: Access control, permission checks
- **Input Validation**: SQL injection prevention, XSS prevention
- **API Security**: Signature verification, timestamp validation
- **Password Handling**: Bcrypt hashing, secret storage

## Adding New Tests

When adding new tests:

1. **Unit Tests**: Create in `tests/unit/` matching the source file structure
2. **Integration Tests**: Create in `tests/integration/` for API endpoints
3. **Follow Patterns**: Use existing tests as templates
4. **Run Locally**: Verify tests pass before committing
5. **Check Coverage**: Ensure coverage remains ≥80%

## Troubleshooting

### Tests Hang
- Check if database/Redis is running
- Verify environment variables are set
- Ensure test timeout is sufficient

### Flaky Tests
- Check for timing issues
- Verify proper cleanup in afterEach/afterAll
- Ensure no shared state between tests

### Low Coverage
- Run `npm run test:coverage` to see detailed report
- Add tests for untested branches
- Focus on critical paths first

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [Testing Best Practices](https://testingjavascript.com/)
