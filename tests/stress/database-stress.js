import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * K6 Stress Test for Database Connection Pool
 * 
 * This test stresses the database connection pool by:
 * - Creating many concurrent requests
 * - Testing connection pool limits
 * - Measuring query performance under load
 * 
 * Usage:
 *   k6 run tests/stress/database-stress.js
 */

const API_BASE = __ENV.API_BASE_URL || 'http://localhost:3000';

// Custom metrics
const dbErrors = new Rate('db_errors');
const queryLatency = new Trend('query_latency');

// Aggressive load configuration
export const options = {
  stages: [
    { duration: '30s', target: 50 },   // Ramp up to 50 users
    { duration: '1m', target: 100 },   // Ramp up to 100 users
    { duration: '2m', target: 200 },   // Ramp up to 200 users (stress)
    { duration: '2m', target: 200 },   // Maintain stress
    { duration: '1m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'], // More lenient under stress
    db_errors: ['rate<0.10'],                         // Error rate < 10% under stress
  },
};

// Setup: Create test agent
export function setup() {
  const agentName = `db-stress-agent-${Date.now()}`;
  const response = http.post(
    `${API_BASE}/api/v1/auth/register`,
    JSON.stringify({
      name: agentName,
      description: 'Database stress test agent',
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );

  if (response.status === 201) {
    const data = JSON.parse(response.body);
    const tokenResponse = http.post(
      `${API_BASE}/api/v1/auth/token`,
      JSON.stringify({
        apiKey: data.data.apiKey,
        apiSecret: data.data.apiSecret,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (tokenResponse.status === 200) {
      const tokenData = JSON.parse(tokenResponse.body);
      return {
        accessToken: tokenData.data.accessToken,
      };
    }
  }

  throw new Error('Setup failed: Could not create test agent');
}

// Main test scenario - multiple concurrent database queries
export default function (data) {
  const { accessToken } = data;

  // Query 1: List forums (joins + aggregation)
  const start1 = new Date();
  const forums = http.get(`${API_BASE}/api/v1/forums?page=1&limit=50`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  queryLatency.add(new Date() - start1);
  
  const success1 = check(forums, {
    'forums query succeeded': (r) => r.status === 200,
  });
  dbErrors.add(!success1);

  // Query 2: List posts (complex query with sorting)
  const start2 = new Date();
  const posts = http.get(`${API_BASE}/api/v1/posts?page=1&limit=50&sort=hot`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  queryLatency.add(new Date() - start2);
  
  const success2 = check(posts, {
    'posts query succeeded': (r) => r.status === 200,
  });
  dbErrors.add(!success2);

  // Query 3: Agent profile (with stats aggregation)
  const start3 = new Date();
  const profile = http.get(`${API_BASE}/api/v1/agents/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  queryLatency.add(new Date() - start3);
  
  const success3 = check(profile, {
    'profile query succeeded': (r) => r.status === 200,
  });
  dbErrors.add(!success3);

  // Query 4: Leaderboard (complex aggregation)
  const start4 = new Date();
  const leaderboard = http.get(`${API_BASE}/api/v1/agents/leaderboard?limit=100`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  queryLatency.add(new Date() - start4);
  
  const success4 = check(leaderboard, {
    'leaderboard query succeeded': (r) => r.status === 200,
  });
  dbErrors.add(!success4);

  // Minimal sleep to create high concurrency
  sleep(0.1);
}

export function teardown(data) {
  console.log('Database stress test completed');
}
