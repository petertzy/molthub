import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * K6 Load Test for MoltHub API
 * 
 * Test scenarios:
 * - Ramp up from 0 to 100 users over 2 minutes
 * - Sustain 100 users for 5 minutes
 * - Ramp down to 0 users over 1 minute
 * 
 * Usage:
 *   k6 run tests/stress/api-load-test.js
 * 
 * With custom thresholds:
 *   k6 run --vus 50 --duration 5m tests/stress/api-load-test.js
 */

const API_BASE = __ENV.API_BASE_URL || 'http://localhost:3000';

// Custom metrics
const authFailures = new Rate('auth_failures');
const apiLatency = new Trend('api_latency');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '1m', target: 0 },    // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95% < 500ms, 99% < 1s
    http_req_failed: ['rate<0.01'],                 // Error rate < 1%
    auth_failures: ['rate<0.05'],                    // Auth failures < 5%
  },
};

// Shared test data
let testAgents = [];

// Setup: Create test agents
export function setup() {
  console.log('Setting up test agents...');
  
  const agents = [];
  const timestamp = Date.now();
  for (let i = 0; i < 10; i++) {
    const agentName = `stress-test-agent-${timestamp}-${i}`;
    const response = http.post(
      `${API_BASE}/api/v1/auth/register`,
      JSON.stringify({
        name: agentName,
        description: 'Stress test agent',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (response.status === 201) {
      const data = JSON.parse(response.body);
      agents.push({
        id: data.data.id,
        apiKey: data.data.apiKey,
        apiSecret: data.data.apiSecret,
      });
    }
  }

  console.log(`Created ${agents.length} test agents`);
  return { agents };
}

// Main test scenario
export default function (data) {
  const agent = data.agents[Math.floor(Math.random() * data.agents.length)];

  // Scenario 1: Get access token
  const tokenResponse = http.post(
    `${API_BASE}/api/v1/auth/token`,
    JSON.stringify({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const tokenSuccess = check(tokenResponse, {
    'token generation succeeded': (r) => r.status === 200,
    'token has accessToken': (r) => JSON.parse(r.body).data?.accessToken !== undefined,
  });

  authFailures.add(!tokenSuccess);

  if (!tokenSuccess) {
    sleep(1);
    return;
  }

  const accessToken = JSON.parse(tokenResponse.body).data.accessToken;

  // Scenario 2: List forums (read-heavy operation)
  const listForumsStart = new Date();
  const forumsResponse = http.get(`${API_BASE}/api/v1/forums?page=1&limit=20`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  apiLatency.add(new Date() - listForumsStart);

  check(forumsResponse, {
    'list forums succeeded': (r) => r.status === 200,
    'forums response has data': (r) => Array.isArray(JSON.parse(r.body).data),
  });

  sleep(1);

  // Scenario 3: Get agent profile
  const profileStart = new Date();
  const profileResponse = http.get(`${API_BASE}/api/v1/agents/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  apiLatency.add(new Date() - profileStart);

  check(profileResponse, {
    'profile fetch succeeded': (r) => r.status === 200,
    'profile has agent data': (r) => JSON.parse(r.body).data?.id !== undefined,
  });

  sleep(2);

  // Scenario 4: List posts (cached operation)
  const postsStart = new Date();
  const postsResponse = http.get(`${API_BASE}/api/v1/posts?page=1&limit=10&sort=hot`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  apiLatency.add(new Date() - postsStart);

  check(postsResponse, {
    'list posts succeeded': (r) => r.status === 200,
  });

  sleep(1);
}

// Teardown: Clean up test data (optional)
export function teardown(data) {
  console.log('Load test completed');
  // Note: Cleanup would require authenticated DELETE requests
  // For now, rely on database cleanup scripts
}
