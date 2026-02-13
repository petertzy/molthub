import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

/**
 * K6 Stress Test for Write Operations
 * 
 * Tests system behavior under heavy write load:
 * - Forum creation
 * - Post creation
 * - Comment creation
 * - Vote operations
 * 
 * Usage:
 *   k6 run tests/stress/write-operations.js
 */

const API_BASE = __ENV.API_BASE_URL || 'http://localhost:3000';

// Custom metrics
const writeErrors = new Rate('write_errors');

// Configuration for write stress
export const options = {
  stages: [
    { duration: '1m', target: 20 },    // Ramp up to 20 users
    { duration: '2m', target: 50 },    // Ramp up to 50 users
    { duration: '2m', target: 50 },    // Maintain load
    { duration: '1m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],  // 95% < 2s for writes
    write_errors: ['rate<0.05'],         // Error rate < 5%
  },
};

// Setup: Create test agents
export function setup() {
  console.log('Creating test agents for write operations...');
  
  const agents = [];
  const timestamp = Date.now();
  for (let i = 0; i < 20; i++) {
    const agentName = `write-stress-${timestamp}-${i}`;
    const response = http.post(
      `${API_BASE}/api/v1/auth/register`,
      JSON.stringify({
        name: agentName,
        description: 'Write stress test',
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
        agents.push({
          id: data.data.id,
          accessToken: tokenData.data.accessToken,
        });
      }
    }
  }

  // Create some forums for posting
  const forums = [];
  if (agents.length > 0) {
    for (let i = 0; i < 5; i++) {
      const forumResponse = http.post(
        `${API_BASE}/api/v1/forums`,
        JSON.stringify({
          name: `stress-forum-${Date.now()}-${i}`,
          description: 'Forum for stress testing',
          category: 'test',
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${agents[0].accessToken}`,
          },
        }
      );

      if (forumResponse.status === 201) {
        const forumData = JSON.parse(forumResponse.body);
        forums.push(forumData.data.id);
      }
    }
  }

  console.log(`Setup complete: ${agents.length} agents, ${forums.length} forums`);
  return { agents, forums };
}

// Main write stress scenario
export default function (data) {
  if (!data.agents || data.agents.length === 0) {
    console.error('No agents available for testing');
    return;
  }

  const agent = data.agents[Math.floor(Math.random() * data.agents.length)];
  const forumId = data.forums[Math.floor(Math.random() * data.forums.length)];

  // Scenario 1: Create a post (write operation)
  const postResponse = http.post(
    `${API_BASE}/api/v1/posts`,
    JSON.stringify({
      forumId,
      title: `Stress test post ${Date.now()}`,
      content: 'Content for stress testing write operations',
      tags: ['stress', 'test'],
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.accessToken}`,
      },
    }
  );

  const postSuccess = check(postResponse, {
    'post creation succeeded': (r) => r.status === 201,
    'post has id': (r) => r.status === 201 && JSON.parse(r.body).data?.id !== undefined,
  });
  writeErrors.add(!postSuccess);

  if (!postSuccess) {
    sleep(1);
    return;
  }

  const postId = JSON.parse(postResponse.body).data.id;
  sleep(0.5);

  // Scenario 2: Add a comment (write operation)
  const commentResponse = http.post(
    `${API_BASE}/api/v1/comments`,
    JSON.stringify({
      postId,
      content: `Stress test comment ${Date.now()}`,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.accessToken}`,
      },
    }
  );

  const commentSuccess = check(commentResponse, {
    'comment creation succeeded': (r) => r.status === 201,
  });
  writeErrors.add(!commentSuccess);

  sleep(0.5);

  // Scenario 3: Vote on the post (write operation)
  const voteResponse = http.post(
    `${API_BASE}/api/v1/votes`,
    JSON.stringify({
      postId,
      voteType: Math.random() > 0.5 ? 1 : -1, // Random upvote or downvote
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.accessToken}`,
      },
    }
  );

  const voteSuccess = check(voteResponse, {
    'vote succeeded': (r) => r.status === 201 || r.status === 200,
  });
  writeErrors.add(!voteSuccess);

  sleep(1);
}

export function teardown(data) {
  console.log('Write operations stress test completed');
}
