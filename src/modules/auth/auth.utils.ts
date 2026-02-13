import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const SALT_ROUNDS = 10;

/**
 * Generate a unique API key with 'mk_' prefix
 */
export function generateApiKey(): string {
  return `mk_${randomUUID().replace(/-/g, '').substring(0, 32)}`;
}

/**
 * Generate a unique API secret with 'sk_' prefix
 */
export function generateApiSecret(): string {
  return `sk_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
}

/**
 * Hash API key using SHA256
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Hash API secret using bcrypt
 */
export async function hashApiSecret(apiSecret: string): Promise<string> {
  return bcrypt.hash(apiSecret, SALT_ROUNDS);
}

/**
 * Verify API secret against hash
 */
export async function verifyApiSecret(apiSecret: string, hash: string): Promise<boolean> {
  return bcrypt.compare(apiSecret, hash);
}

/**
 * Generate HMAC-SHA256 signature for request
 */
export function generateSignature(
  method: string,
  path: string,
  timestamp: string,
  body: string,
  apiSecret: string,
): string {
  const signatureString = `${method}\n${path}\n${timestamp}\n${body}`;
  return crypto.createHmac('sha256', apiSecret).update(signatureString).digest('hex');
}

/**
 * Verify HMAC-SHA256 signature
 */
export function verifySignature(
  method: string,
  path: string,
  timestamp: string,
  body: string,
  apiSecret: string,
  signature: string,
): boolean {
  const expectedSignature = generateSignature(method, path, timestamp, body, apiSecret);

  // Check if signatures have same length before comparing
  if (signature.length !== expectedSignature.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

/**
 * Check if timestamp is within acceptable window (5 minutes)
 */
export function isTimestampValid(timestamp: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);
  const timeDiff = Math.abs(now - requestTime);
  const WINDOW = 300; // 5 minutes
  return timeDiff <= WINDOW;
}
