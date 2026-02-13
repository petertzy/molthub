import {
  generateApiKey,
  generateApiSecret,
  hashApiKey,
  hashApiSecret,
  verifyApiSecret,
  generateSignature,
  verifySignature,
  isTimestampValid,
} from '@modules/auth/auth.utils';

// Mock uuid to avoid ESM issues with jest
jest.mock('uuid', () => ({
  v4: () => 'test-uuid-1234-5678-1234-567890abcdef',
}));

describe('Auth Utils', () => {
  describe('generateApiKey', () => {
    it('should generate a key with mk_ prefix', () => {
      const key = generateApiKey();
      expect(key).toMatch(/^mk_/);
    });

    it('should generate a 35 character key (mk_ + 32 chars)', () => {
      const key = generateApiKey();
      expect(key.length).toBe(35);
    });
  });

  describe('generateApiSecret', () => {
    it('should generate a secret with sk_ prefix', () => {
      const secret = generateApiSecret();
      expect(secret).toMatch(/^sk_/);
    });

    it('should generate a 67 character secret (sk_ + 64 chars)', () => {
      const secret = generateApiSecret();
      expect(secret.length).toBe(67);
    });
  });

  describe('hashApiKey', () => {
    it('should generate consistent hash for same input', () => {
      const key = 'mk_test123';
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different keys', () => {
      const hash1 = hashApiKey('mk_test123');
      const hash2 = hashApiKey('mk_test456');
      expect(hash1).not.toBe(hash2);
    });

    it('should generate 64 character hex hash (SHA256)', () => {
      const hash = hashApiKey('mk_test');
      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('hashApiSecret and verifyApiSecret', () => {
    it('should hash and verify secret correctly', async () => {
      const secret = 'sk_testsecret123';
      const hash = await hashApiSecret(secret);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(secret);

      const isValid = await verifyApiSecret(secret, hash);
      expect(isValid).toBe(true);
    });

    it('should fail verification with wrong secret', async () => {
      const secret = 'sk_testsecret123';
      const hash = await hashApiSecret(secret);

      const isValid = await verifyApiSecret('sk_wrongsecret', hash);
      expect(isValid).toBe(false);
    });

    it('should generate different hashes for same secret (bcrypt salt)', async () => {
      const secret = 'sk_testsecret123';
      const hash1 = await hashApiSecret(secret);
      const hash2 = await hashApiSecret(secret);

      expect(hash1).not.toBe(hash2);

      // Both should verify correctly
      expect(await verifyApiSecret(secret, hash1)).toBe(true);
      expect(await verifyApiSecret(secret, hash2)).toBe(true);
    });
  });

  describe('generateSignature', () => {
    it('should generate consistent signature for same inputs', () => {
      const method = 'POST';
      const path = '/api/v1/auth/token';
      const timestamp = '1234567890';
      const body = '';
      const secret = 'sk_test';

      const sig1 = generateSignature(method, path, timestamp, body, secret);
      const sig2 = generateSignature(method, path, timestamp, body, secret);

      expect(sig1).toBe(sig2);
    });

    it('should generate different signatures for different secrets', () => {
      const method = 'POST';
      const path = '/api/v1/auth/token';
      const timestamp = '1234567890';
      const body = '';

      const sig1 = generateSignature(method, path, timestamp, body, 'secret1');
      const sig2 = generateSignature(method, path, timestamp, body, 'secret2');

      expect(sig1).not.toBe(sig2);
    });

    it('should generate different signatures for different inputs', () => {
      const secret = 'sk_test';
      const timestamp = '1234567890';
      const body = '';

      const sig1 = generateSignature('POST', '/api/v1/auth/token', timestamp, body, secret);
      const sig2 = generateSignature('GET', '/api/v1/auth/token', timestamp, body, secret);
      const sig3 = generateSignature('POST', '/api/v1/auth/verify', timestamp, body, secret);

      expect(sig1).not.toBe(sig2);
      expect(sig1).not.toBe(sig3);
    });
  });

  describe('verifySignature', () => {
    it('should verify valid signature', () => {
      const method = 'POST';
      const path = '/api/v1/auth/token';
      const timestamp = '1234567890';
      const body = '';
      const secret = 'sk_test';

      const signature = generateSignature(method, path, timestamp, body, secret);
      const isValid = verifySignature(method, path, timestamp, body, secret, signature);

      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const method = 'POST';
      const path = '/api/v1/auth/token';
      const timestamp = '1234567890';
      const body = '';
      const secret = 'sk_test';

      const isValid = verifySignature(method, path, timestamp, body, secret, 'invalid-signature');

      expect(isValid).toBe(false);
    });

    it('should reject signature with wrong secret', () => {
      const method = 'POST';
      const path = '/api/v1/auth/token';
      const timestamp = '1234567890';
      const body = '';

      const signature = generateSignature(method, path, timestamp, body, 'secret1');
      const isValid = verifySignature(method, path, timestamp, body, 'secret2', signature);

      expect(isValid).toBe(false);
    });
  });

  describe('isTimestampValid', () => {
    it('should accept current timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(isTimestampValid(now.toString())).toBe(true);
    });

    it('should accept timestamp within 5 minute window', () => {
      const now = Math.floor(Date.now() / 1000);
      const past = (now - 299).toString(); // 4:59 ago
      const future = (now + 299).toString(); // 4:59 in future

      expect(isTimestampValid(past)).toBe(true);
      expect(isTimestampValid(future)).toBe(true);
    });

    it('should reject timestamp outside 5 minute window', () => {
      const now = Math.floor(Date.now() / 1000);
      const oldPast = (now - 301).toString(); // 5:01 ago
      const farFuture = (now + 301).toString(); // 5:01 in future

      expect(isTimestampValid(oldPast)).toBe(false);
      expect(isTimestampValid(farFuture)).toBe(false);
    });

    it('should reject very old timestamps', () => {
      const veryOld = '1000000000'; // Year 2001
      expect(isTimestampValid(veryOld)).toBe(false);
    });
  });
});
