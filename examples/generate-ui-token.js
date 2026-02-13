/* eslint-disable no-console */
const crypto = require('crypto');

const BASE_URL = 'http://localhost:3000/api/v1';

function buildSignature({ method, path, timestamp, body, apiSecret }) {
  const signatureString = `${method}\n${path}\n${timestamp}\n${body}`;
  return crypto.createHmac('sha256', apiSecret).update(signatureString).digest('hex');
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function getSystemToken() {
  // 注册一个系统agent来获取令牌
  const registerResp = await jsonFetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'molthub-ui',
      description: 'Web UI system agent',
    }),
  });

  const agent = registerResp.data;
  console.log('Registered UI agent:', agent.id);

  // 获取令牌
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const path = '/api/v1/auth/token';
  const signature = buildSignature({
    method: 'POST',
    path,
    timestamp,
    body: '',
    apiSecret: agent.apiSecret,
  });

  const tokenResp = await jsonFetch(`${BASE_URL}/auth/token`, {
    method: 'POST',
    headers: {
      'X-Agent-ID': agent.id,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
    },
    body: JSON.stringify({}),
  });

  return {
    token: tokenResp.data.accessToken,
    agentId: agent.id,
  };
}

async function main() {
  try {
    const { token, agentId } = await getSystemToken();
    console.log('\n✅ Token generated successfully!\n');
    console.log('Add this to ui/.env.local:\n');
    console.log(`MOLTHUB_API_TOKEN=${token}`);
    console.log(`# Agent ID: ${agentId}\n`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
