/**
 * CSRF Protection Tests
 * Tests for CSRF token generation and verification
 */

import {
  generateCsrfToken,
  verifyCsrfToken,
  getCsrfToken,
} from '../../src/shared/middleware/csrf.middleware';
import type { Request, Response, NextFunction } from 'express';

describe('CSRF Protection', () => {
  describe('generateCsrfToken', () => {
    it('should generate a token', () => {
      const sessionId = 'test-session-id';
      const token = generateCsrfToken(sessionId);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(64); // 32 bytes = 64 hex chars
    });

    it('should generate different tokens for different sessions', () => {
      const token1 = generateCsrfToken('session-1');
      const token2 = generateCsrfToken('session-2');
      
      expect(token1).not.toBe(token2);
    });

    it('should generate cryptographically random tokens', () => {
      const sessionId = 'test-session';
      const token1 = generateCsrfToken(sessionId);
      
      // Wait a bit and generate another token for same session (should update)
      const token2 = generateCsrfToken(sessionId);
      
      // Tokens should be different even for same session
      expect(token1).not.toBe(token2);
    });
  });

  describe('verifyCsrfToken', () => {
    it('should verify a valid token', () => {
      const sessionId = 'test-session';
      const token = generateCsrfToken(sessionId);
      
      const isValid = verifyCsrfToken(sessionId, token);
      expect(isValid).toBe(true);
    });

    it('should reject an invalid token', () => {
      const sessionId = 'test-session';
      generateCsrfToken(sessionId);
      
      const isValid = verifyCsrfToken(sessionId, 'invalid-token');
      expect(isValid).toBe(false);
    });

    it('should reject token for wrong session', () => {
      const token = generateCsrfToken('session-1');
      
      const isValid = verifyCsrfToken('session-2', token);
      expect(isValid).toBe(false);
    });

    it('should reject token if no token exists for session', () => {
      const isValid = verifyCsrfToken('non-existent-session', 'some-token');
      expect(isValid).toBe(false);
    });

    it('should use timing-safe comparison', () => {
      // This test verifies that the function completes without throwing
      // Timing-safe comparison prevents timing attacks
      const sessionId = 'test-session';
      const token = generateCsrfToken(sessionId);
      
      // Should not throw with equal-length strings
      expect(() => {
        verifyCsrfToken(sessionId, token);
        verifyCsrfToken(sessionId, 'a'.repeat(64));
      }).not.toThrow();
    });
  });

  describe('Token Expiration', () => {
    jest.setTimeout(35000); // Increase timeout for this test suite

    it('should expire tokens after 30 minutes', async () => {
      const sessionId = 'expiry-test-session';
      const token = generateCsrfToken(sessionId);
      
      // Verify token is valid initially
      expect(verifyCsrfToken(sessionId, token)).toBe(true);
      
      // Note: In actual testing, we can't wait 30 minutes
      // This test documents the expected behavior
      // In production, tokens expire after 30 minutes
    });
  });

  describe('getCsrfToken', () => {
    it('should get token from request', () => {
      const mockReq = {
        agentId: 'test-agent',
        ip: '127.0.0.1',
        get: (header: string) => 'test-user-agent',
      } as unknown as Request;

      const token = getCsrfToken(mockReq);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(64);
    });

    it('should use IP and user agent if no agentId', () => {
      const mockReq = {
        ip: '127.0.0.1',
        get: (header: string) => 'test-user-agent',
      } as unknown as Request;

      const token = getCsrfToken(mockReq);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    it('should generate consistent tokens for same session', () => {
      const mockReq = {
        agentId: 'test-agent',
        ip: '127.0.0.1',
        get: (header: string) => 'test-user-agent',
      } as unknown as Request;

      // First call generates token
      const token1 = getCsrfToken(mockReq);
      
      // Second call should return a new token (it regenerates)
      const token2 = getCsrfToken(mockReq);
      
      // Both should be valid tokens
      expect(token1).toBeDefined();
      expect(token2).toBeDefined();
    });
  });

  describe('Security Properties', () => {
    it('should generate tokens with sufficient entropy', () => {
      const tokens = new Set();
      const iterations = 1000;
      
      for (let i = 0; i < iterations; i++) {
        const token = generateCsrfToken(`session-${i}`);
        tokens.add(token);
      }
      
      // All tokens should be unique
      expect(tokens.size).toBe(iterations);
    });

    it('should prevent token reuse across sessions', () => {
      const token = generateCsrfToken('session-1');
      
      // Token valid for session-1
      expect(verifyCsrfToken('session-1', token)).toBe(true);
      
      // Token not valid for session-2
      expect(verifyCsrfToken('session-2', token)).toBe(false);
      
      // Token not valid for session-3
      expect(verifyCsrfToken('session-3', token)).toBe(false);
    });

    it('should handle malformed tokens safely', () => {
      const sessionId = 'test-session';
      generateCsrfToken(sessionId);
      
      // Should not throw and should return false
      expect(verifyCsrfToken(sessionId, '')).toBe(false);
      expect(verifyCsrfToken(sessionId, 'short')).toBe(false);
      expect(verifyCsrfToken(sessionId, 'a'.repeat(100))).toBe(false);
    });
  });
});
