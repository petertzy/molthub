import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Authentication Flow
 * 
 * Tests the complete authentication workflow including:
 * - Agent registration
 * - Token generation
 * - API authentication
 * - Token refresh
 */

const API_BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

test.describe('Authentication Flow E2E', () => {
  let agentName: string;
  let apiKey: string;
  let apiSecret: string;
  let accessToken: string;
  let refreshToken: string;

  test.beforeEach(() => {
    // Generate unique agent name for each test
    agentName = `test-agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  });

  test('should complete full registration flow', async ({ request }) => {
    // Step 1: Register a new agent
    const registerResponse = await request.post(`${API_BASE}/api/v1/auth/register`, {
      data: {
        name: agentName,
        description: 'E2E test agent',
      },
    });

    expect(registerResponse.ok()).toBeTruthy();
    const registerData = await registerResponse.json();
    
    expect(registerData.success).toBe(true);
    expect(registerData.data).toHaveProperty('id');
    expect(registerData.data).toHaveProperty('apiKey');
    expect(registerData.data).toHaveProperty('apiSecret');
    
    apiKey = registerData.data.apiKey;
    apiSecret = registerData.data.apiSecret;

    // Step 2: Generate access tokens
    const tokenResponse = await request.post(`${API_BASE}/api/v1/auth/token`, {
      data: {
        apiKey,
        apiSecret,
      },
    });

    expect(tokenResponse.ok()).toBeTruthy();
    const tokenData = await tokenResponse.json();
    
    expect(tokenData.success).toBe(true);
    expect(tokenData.data).toHaveProperty('accessToken');
    expect(tokenData.data).toHaveProperty('refreshToken');
    
    accessToken = tokenData.data.accessToken;
    refreshToken = tokenData.data.refreshToken;

    // Step 3: Verify token works for authenticated endpoint
    const profileResponse = await request.get(`${API_BASE}/api/v1/agents/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    expect(profileResponse.ok()).toBeTruthy();
    const profileData = await profileResponse.json();
    
    expect(profileData.success).toBe(true);
    expect(profileData.data.name).toBe(agentName);
  });

  test('should refresh access token successfully', async ({ request }) => {
    // Step 1: Register and get initial tokens
    const registerResponse = await request.post(`${API_BASE}/api/v1/auth/register`, {
      data: {
        name: agentName,
        description: 'E2E test agent',
      },
    });
    
    const registerData = await registerResponse.json();
    apiKey = registerData.data.apiKey;
    apiSecret = registerData.data.apiSecret;

    const tokenResponse = await request.post(`${API_BASE}/api/v1/auth/token`, {
      data: { apiKey, apiSecret },
    });
    
    const tokenData = await tokenResponse.json();
    refreshToken = tokenData.data.refreshToken;

    // Step 2: Use refresh token to get new access token
    const refreshResponse = await request.post(`${API_BASE}/api/v1/auth/refresh`, {
      data: { refreshToken },
    });

    expect(refreshResponse.ok()).toBeTruthy();
    const refreshData = await refreshResponse.json();
    
    expect(refreshData.success).toBe(true);
    expect(refreshData.data).toHaveProperty('accessToken');
    expect(refreshData.data).toHaveProperty('refreshToken');
    
    const newAccessToken = refreshData.data.accessToken;

    // Step 3: Verify new token works
    const profileResponse = await request.get(`${API_BASE}/api/v1/agents/me`, {
      headers: {
        Authorization: `Bearer ${newAccessToken}`,
      },
    });

    expect(profileResponse.ok()).toBeTruthy();
  });

  test('should reject invalid credentials', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/auth/token`, {
      data: {
        apiKey: 'invalid-key',
        apiSecret: 'invalid-secret',
      },
    });

    expect(response.status()).toBe(401);
  });

  test('should reject duplicate agent registration', async ({ request }) => {
    // Register first agent
    await request.post(`${API_BASE}/api/v1/auth/register`, {
      data: {
        name: agentName,
        description: 'First agent',
      },
    });

    // Try to register with same name
    const duplicateResponse = await request.post(`${API_BASE}/api/v1/auth/register`, {
      data: {
        name: agentName,
        description: 'Duplicate agent',
      },
    });

    expect(duplicateResponse.status()).toBe(400);
    const errorData = await duplicateResponse.json();
    expect(errorData.error).toBeTruthy();
  });

  test('should reject requests without authentication', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/v1/agents/me`);
    
    expect(response.status()).toBe(401);
  });

  test('should reject requests with invalid token', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/v1/agents/me`, {
      headers: {
        Authorization: 'Bearer invalid-token-here',
      },
    });
    
    expect(response.status()).toBe(401);
  });
});
