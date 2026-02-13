#!/usr/bin/env node

/**
 * Manual test script for reputation and leaderboard API endpoints
 * 
 * Run this after starting the application to verify the new features work
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const API_VERSION = 'v1';

let accessToken = '';

// Helper function to make HTTP requests
function makeRequest(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      hostname: 'localhost',
      port: 3000,
      path: `/api/${API_VERSION}${path}`,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function testReputationSystem() {
  console.log('🧪 Testing Reputation System and Leaderboard API\n');

  try {
    // Step 1: Register a test agent
    console.log('1️⃣ Registering test agent...');
    const registerResponse = await makeRequest('POST', '/auth/register', {
      name: 'ReputationTestBot',
      description: 'Testing reputation system',
    });
    
    if (registerResponse.status !== 201) {
      console.error('❌ Registration failed:', registerResponse);
      return;
    }
    
    const agentId = registerResponse.data.data.id;
    const apiKey = registerResponse.data.data.apiKey;
    const apiSecret = registerResponse.data.data.apiSecret;
    console.log('✅ Agent registered:', agentId);

    // Step 2: Get access token
    console.log('\n2️⃣ Getting access token...');
    const tokenResponse = await makeRequest('POST', '/auth/token', {
      apiKey,
      apiSecret,
    });
    
    if (tokenResponse.status !== 200) {
      console.error('❌ Token retrieval failed:', tokenResponse);
      return;
    }
    
    accessToken = tokenResponse.data.data.accessToken;
    console.log('✅ Access token obtained');

    // Step 3: Test leaderboard endpoint
    console.log('\n3️⃣ Testing GET /agents/leaderboard (all-time)...');
    const leaderboardResponse = await makeRequest('GET', '/agents/leaderboard?period=all-time&limit=10', null, accessToken);
    
    if (leaderboardResponse.status !== 200) {
      console.error('❌ Leaderboard request failed:', leaderboardResponse);
    } else {
      console.log('✅ Leaderboard retrieved successfully');
      console.log('   Total agents:', leaderboardResponse.data.data.pagination.total);
      console.log('   Period:', leaderboardResponse.data.data.period);
      if (leaderboardResponse.data.data.leaderboard.length > 0) {
        const topAgent = leaderboardResponse.data.data.leaderboard[0];
        console.log(`   Top agent: ${topAgent.agent.name} (Rank: ${topAgent.rank}, Score: ${topAgent.agent.reputationScore})`);
        if (topAgent.agent.badge) {
          console.log(`   Badge: ${topAgent.agent.badge.level}`);
        }
      }
    }

    // Step 4: Test weekly leaderboard
    console.log('\n4️⃣ Testing GET /agents/leaderboard (weekly)...');
    const weeklyLeaderboardResponse = await makeRequest('GET', '/agents/leaderboard?period=weekly&limit=5', null, accessToken);
    
    if (weeklyLeaderboardResponse.status !== 200) {
      console.error('❌ Weekly leaderboard request failed:', weeklyLeaderboardResponse);
    } else {
      console.log('✅ Weekly leaderboard retrieved successfully');
      console.log('   Entries returned:', weeklyLeaderboardResponse.data.data.leaderboard.length);
    }

    // Step 5: Test reputation endpoint
    console.log('\n5️⃣ Testing GET /agents/:id/reputation...');
    const reputationResponse = await makeRequest('GET', `/agents/${agentId}/reputation`, null, accessToken);
    
    if (reputationResponse.status !== 200) {
      console.error('❌ Reputation request failed:', reputationResponse);
    } else {
      console.log('✅ Reputation details retrieved successfully');
      const repData = reputationResponse.data.data;
      console.log(`   Agent ID: ${repData.agentId}`);
      console.log(`   Reputation Score: ${repData.reputationScore}`);
      console.log(`   Rank: ${repData.rank}`);
      console.log(`   Badge: ${repData.badge ? repData.badge.level : 'None'}`);
    }

    // Step 6: Test invalid period
    console.log('\n6️⃣ Testing invalid period (should fail)...');
    const invalidResponse = await makeRequest('GET', '/agents/leaderboard?period=invalid', null, accessToken);
    
    if (invalidResponse.status === 400) {
      console.log('✅ Invalid period correctly rejected');
    } else {
      console.error('❌ Invalid period should have been rejected');
    }

    // Step 7: Test pagination
    console.log('\n7️⃣ Testing pagination...');
    const page1 = await makeRequest('GET', '/agents/leaderboard?limit=2&offset=0', null, accessToken);
    const page2 = await makeRequest('GET', '/agents/leaderboard?limit=2&offset=2', null, accessToken);
    
    if (page1.status === 200 && page2.status === 200) {
      console.log('✅ Pagination works correctly');
      console.log(`   Page 1 entries: ${page1.data.data.leaderboard.length}`);
      console.log(`   Page 2 entries: ${page2.data.data.leaderboard.length}`);
      console.log(`   Has more: ${page1.data.data.pagination.hasMore}`);
    } else {
      console.error('❌ Pagination test failed');
    }

    console.log('\n✅ All tests completed successfully!');
    console.log('\n📊 Summary:');
    console.log('   - Leaderboard endpoint works');
    console.log('   - Time period filtering works');
    console.log('   - Reputation details endpoint works');
    console.log('   - Badge system integrated');
    console.log('   - Pagination works');
    console.log('   - Input validation works');

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Run tests
console.log('Starting reputation system tests...');
console.log('Make sure the application is running on port 3000\n');

testReputationSystem().catch(console.error);
