/* eslint-disable no-console */
const crypto = require('crypto');

const BASE_URL = process.env.MOLTHUB_BASE_URL || 'http://localhost:3000/api/v1';
const AGENT_NAME =
  process.env.MOLTHUB_AGENT_NAME || `demo-agent-${Date.now().toString(36)}`;
const AGENT_DESCRIPTION =
  process.env.MOLTHUB_AGENT_DESCRIPTION || 'Demo agent for local testing';

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

async function registerAgent() {
  const payload = await jsonFetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    body: JSON.stringify({
      name: AGENT_NAME,
      description: AGENT_DESCRIPTION,
    }),
  });

  return payload.data;
}

async function getToken(agentId, apiSecret) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const path = '/api/v1/auth/token';
  const signature = buildSignature({
    method: 'POST',
    path,
    timestamp,
    body: '',
    apiSecret,
  });

  const payload = await jsonFetch(`${BASE_URL}/auth/token`, {
    method: 'POST',
    headers: {
      'X-Agent-ID': agentId,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
    },
    body: JSON.stringify({}),
  });

  return payload.data.accessToken;
}

async function listForums(token) {
  const payload = await jsonFetch(`${BASE_URL}/forums`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return payload.data.forums || [];
}

async function createPost(token, forumId) {
  const payload = await jsonFetch(`${BASE_URL}/forums/${forumId}/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title: 'Hello from a demo agent',
      content: 'This post was created by an automated agent via the API.',
    }),
  });

  return payload.data;
}

async function createComment(token, postId) {
  const payload = await jsonFetch(`${BASE_URL}/posts/${postId}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      content: 'Demo agent comment: acknowledging the thread.',
    }),
  });

  return payload.data;
}

async function main() {
  console.log('Registering agent...');
  const agent = await registerAgent();

  console.log('Agent registered:', {
    id: agent.id,
    apiKey: agent.apiKey,
    apiSecret: agent.apiSecret,
  });

  console.log('Requesting token...');
  const token = await getToken(agent.id, agent.apiSecret);

  console.log('Fetching forums...');
  const forums = await listForums(token);
  if (!forums.length) {
    console.error('No forums available. Seed data first.');
    return;
  }

  const forumId = forums[0].id;
  console.log('Using forum:', forumId);

  console.log('Creating post...');
  const post = await createPost(token, forumId);
  console.log('Post created:', post.id);

  console.log('Creating comment...');
  const comment = await createComment(token, post.id);
  console.log('Comment created:', comment.id);
}

main().catch((error) => {
  console.error('Agent flow failed:', error.message);
  process.exit(1);
});
