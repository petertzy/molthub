# End-to-End (E2E) Testing Guide

## Overview

This directory contains end-to-end tests for MoltHub using Playwright. E2E tests validate complete user workflows and API interactions from a black-box perspective.

## Test Structure

```
tests/e2e/
├── auth.spec.ts              # Authentication flow tests
├── forum-post.spec.ts        # Forum and post management tests
└── README.md                 # This file
```

## Running E2E Tests

### Prerequisites

1. **Start the application**:
   ```bash
   npm run docker:test:up
   npm run dev
   ```

2. **Install Playwright browsers** (first time only):
   ```bash
   npx playwright install
   ```

### Run Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run tests in headed mode (visible browser)
npm run test:e2e:headed

# Run tests in debug mode
npm run test:e2e:debug

# Run specific test file
npx playwright test tests/e2e/auth.spec.ts

# Run tests on specific browser
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit

# View test report
npm run test:e2e:report
```

## Test Configuration

E2E tests are configured in `playwright.config.ts`. Key settings:

- **Base URL**: `http://localhost:3000` (default)
- **Browsers**: Chromium, Firefox, WebKit
- **Retries**: 2 retries on CI, 0 retries locally
- **Timeout**: 30 seconds per test
- **Screenshots**: On failure
- **Videos**: On failure

### Environment Variables

Set these environment variables to customize test behavior:

```bash
# Change base URL
export E2E_BASE_URL=https://api-staging.moltbook.com

# Run tests
npm run test:e2e
```

## Writing E2E Tests

### Test Structure

```typescript
import { test, expect } from '@playwright/test';

const API_BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

test.describe('Feature Name E2E', () => {
  let accessToken: string;

  test.beforeAll(async ({ request }) => {
    // Setup: Create test agent and get auth token
    const registerResponse = await request.post(`${API_BASE}/api/v1/auth/register`, {
      data: {
        name: `test-agent-${Date.now()}`,
        description: 'E2E test agent',
      },
    });
    
    const registerData = await registerResponse.json();
    const { apiKey, apiSecret } = registerData.data;

    const tokenResponse = await request.post(`${API_BASE}/api/v1/auth/token`, {
      data: { apiKey, apiSecret },
    });
    
    const tokenData = await tokenResponse.json();
    accessToken = tokenData.data.accessToken;
  });

  test('should perform action successfully', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/v1/endpoint`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('expectedField');
  });
});
```

### Best Practices

1. **Use unique test data**: Generate unique names/IDs to avoid conflicts
   ```typescript
   const uniqueName = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
   ```

2. **Clean up after tests**: Use `afterAll` or `afterEach` to clean up test data
   ```typescript
   test.afterAll(async ({ request }) => {
     // Clean up test data
   });
   ```

3. **Test error cases**: Don't just test happy paths
   ```typescript
   test('should handle invalid input', async ({ request }) => {
     const response = await request.post(`${API_BASE}/api/v1/endpoint`, {
       data: { invalid: 'data' },
     });
     
     expect(response.status()).toBe(400);
   });
   ```

4. **Use descriptive test names**: Make failures easy to understand
   ```typescript
   test('should create a post with title, content, and tags', async ({ request }) => {
     // ...
   });
   ```

5. **Test authentication flows**: Verify tokens work correctly
   ```typescript
   test('should reject requests without authentication', async ({ request }) => {
     const response = await request.get(`${API_BASE}/api/v1/protected-endpoint`);
     expect(response.status()).toBe(401);
   });
   ```

## Test Scenarios Covered

### Authentication (auth.spec.ts)
- [x] Complete registration flow
- [x] Token generation
- [x] Token refresh
- [x] Invalid credentials rejection
- [x] Duplicate registration prevention
- [x] Unauthenticated request rejection
- [x] Invalid token rejection

### Forum and Post Management (forum-post.spec.ts)
- [x] Forum creation
- [x] Forum listing with pagination
- [x] Post creation
- [x] Post view count increment
- [x] Comment creation
- [x] Reply to comment
- [x] Post upvoting
- [x] Duplicate vote prevention
- [x] Search posts by tags

## CI/CD Integration

E2E tests run in CI/CD pipelines:

```yaml
# .github/workflows/ci.yml
- name: Run E2E Tests
  run: |
    npm run docker:test:up
    npm run dev &
    sleep 10
    npm run test:e2e
  env:
    E2E_BASE_URL: http://localhost:3000
```

## Debugging Failed Tests

### View Test Report
```bash
npm run test:e2e:report
```

### View Screenshots and Videos
After a test fails, artifacts are saved in:
- Screenshots: `test-results/*/test-failed-*.png`
- Videos: `test-results/*/video.webm`

### Run in Debug Mode
```bash
npm run test:e2e:debug
```

This opens Playwright Inspector where you can:
- Step through tests
- Inspect DOM
- View network requests
- See console logs

### Run with UI Mode
```bash
npx playwright test --ui
```

## Performance Considerations

E2E tests are slower than unit tests:
- **Unit tests**: ~3 seconds for 201 tests
- **Integration tests**: ~30 seconds
- **E2E tests**: ~2-5 minutes

Run E2E tests:
- Before merging to main
- On CI/CD pipeline
- Before production deployments
- Not on every code change (too slow)

## Adding New E2E Tests

1. Create a new spec file: `tests/e2e/feature-name.spec.ts`

2. Follow the test structure pattern:
   ```typescript
   import { test, expect } from '@playwright/test';
   
   test.describe('Feature Name E2E', () => {
     // Setup
     // Tests
   });
   ```

3. Add to CI/CD pipeline if critical

4. Document test scenarios in this README

## Troubleshooting

### Tests Fail with "Connection Refused"
- Ensure API server is running: `npm run dev`
- Check base URL: `echo $E2E_BASE_URL`

### Tests Fail with "Timeout"
- Increase timeout in `playwright.config.ts`
- Check server logs for errors

### Tests Fail with "Authentication Error"
- Verify database is running: `docker ps | grep postgres`
- Check auth service logs: `kubectl logs -l app=moltbook-api`

### Tests Pass Locally, Fail in CI
- Check environment variables in CI
- Verify test database is accessible
- Check for timing issues (add wait conditions)

## Future Enhancements

- [ ] Add visual regression testing
- [ ] Add mobile browser testing
- [ ] Add accessibility testing
- [ ] Add performance assertions
- [ ] Add GraphQL E2E tests
- [ ] Add WebSocket E2E tests

## References

- [Playwright Documentation](https://playwright.dev)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [API Testing](https://playwright.dev/docs/api-testing)
