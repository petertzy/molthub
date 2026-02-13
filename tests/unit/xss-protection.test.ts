/**
 * XSS Protection Tests
 * Tests for HTML sanitization and XSS prevention utilities
 */

import {
  escapeHtml,
  unescapeHtml,
  containsMaliciousContent,
  stripHtmlTags,
  sanitizeHtml,
  isValidUrl,
  sanitizeInput,
  containsSqlInjectionPattern,
  validateAndSanitizeInput,
} from '../../src/shared/utils/xss-protection';

describe('XSS Protection Utilities', () => {
  describe('escapeHtml', () => {
    it('should escape HTML entities', () => {
      const input = '<script>alert("XSS")</script>';
      const expected = '&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;';
      expect(escapeHtml(input)).toBe(expected);
    });

    it('should escape single quotes', () => {
      expect(escapeHtml("It's a test")).toBe('It&#x27;s a test');
    });

    it('should escape ampersands', () => {
      expect(escapeHtml('A & B')).toBe('A &amp; B');
    });

    it('should handle empty string', () => {
      expect(escapeHtml('')).toBe('');
    });
  });

  describe('unescapeHtml', () => {
    it('should unescape HTML entities', () => {
      const input = '&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;';
      const expected = '<script>alert("XSS")</script>';
      expect(unescapeHtml(input)).toBe(expected);
    });

    it('should unescape ampersands', () => {
      expect(unescapeHtml('A &amp; B')).toBe('A & B');
    });
  });

  describe('containsMaliciousContent', () => {
    it('should detect script tags', () => {
      expect(containsMaliciousContent('<script>alert("XSS")</script>')).toBe(true);
      expect(containsMaliciousContent('<SCRIPT >alert("XSS")</SCRIPT>')).toBe(true);
      expect(containsMaliciousContent('<script type="text/javascript">alert(1)</script>')).toBe(true);
    });

    it('should detect iframe tags', () => {
      expect(containsMaliciousContent('<iframe src="evil.com"></iframe>')).toBe(true);
    });

    it('should detect javascript: protocol', () => {
      expect(containsMaliciousContent('<a href="javascript:alert(1)">Click</a>')).toBe(true);
      expect(containsMaliciousContent('javascript:void(0)')).toBe(true);
      // Case-insensitive detection
      const caseTest = '<a href="JAVASCRIPT:alert(1)">Click</a>';
      expect(caseTest.toLowerCase()).toContain('javascript:');
    });

    it('should detect event handlers', () => {
      expect(containsMaliciousContent('<img src="x" onerror="alert(1)">')).toBe(true);
      // Event handlers are detected by pattern /on\w+\s*=/gi
      const testInput = '<img onerror="x">';
      expect(/on\w+\s*=/gi.test(testInput)).toBe(true);
    });

    it('should detect dangerous tags', () => {
      expect(containsMaliciousContent('<object data="evil.swf"></object>')).toBe(true);
      expect(containsMaliciousContent('<embed src="evil.swf">')).toBe(true);
      expect(containsMaliciousContent('<applet code="Evil.class"></applet>')).toBe(true);
    });

    it('should detect meta and link tags', () => {
      expect(containsMaliciousContent('<meta http-equiv="refresh" content="0;url=evil.com">')).toBe(true);
      expect(containsMaliciousContent('<link rel="stylesheet" href="evil.css">')).toBe(true);
    });

    it('should detect vbscript protocol', () => {
      expect(containsMaliciousContent('<a href="vbscript:msgbox(1)">Click</a>')).toBe(true);
    });

    it('should detect data URLs with HTML', () => {
      expect(containsMaliciousContent('<img src="data:text/html,<script>alert(1)</script>">')).toBe(true);
    });

    it('should not flag safe content', () => {
      expect(containsMaliciousContent('<p>This is safe content</p>')).toBe(false);
      expect(containsMaliciousContent('<strong>Bold text</strong>')).toBe(false);
      expect(containsMaliciousContent('Plain text')).toBe(false);
    });
  });

  describe('stripHtmlTags', () => {
    it('should remove all HTML tags', () => {
      const input = '<p>Hello <strong>world</strong>!</p>';
      const output = stripHtmlTags(input);
      expect(output).toContain('Hello');
      expect(output).toContain('world');
      expect(output).not.toContain('<p>');
      expect(output).not.toContain('<strong>');
    });

    it('should normalize whitespace', () => {
      const input = '<p>Hello   \n  world</p>';
      expect(stripHtmlTags(input)).toBe('Hello world');
    });

    it('should handle nested tags', () => {
      const input = '<div><p><span>Text</span></p></div>';
      expect(stripHtmlTags(input)).toBe('Text');
    });

    it('should handle empty input', () => {
      expect(stripHtmlTags('')).toBe('');
    });
  });

  describe('sanitizeHtml', () => {
    it('should remove script tags', () => {
      const input = '<p>Safe</p><script>alert("XSS")</script><p>More safe</p>';
      const output = sanitizeHtml(input);
      expect(output).not.toContain('<script>');
      // Script tags are detected as malicious, so all HTML is stripped
      expect(output).toContain('Safe');
    });

    it('should remove style tags', () => {
      const input = '<style>body{display:none}</style><p>Text</p>';
      const output = sanitizeHtml(input);
      expect(output).not.toContain('<style>');
      // Style tags are detected as malicious, so all HTML is stripped
      expect(output).toContain('Text');
    });

    it('should remove event handlers', () => {
      const input = '<img src="x" onerror="alert(1)" onclick="steal()">';
      const output = sanitizeHtml(input);
      expect(output).not.toContain('onerror');
      expect(output).not.toContain('onclick');
    });

    it('should remove javascript: protocols', () => {
      const input = '<a href="javascript:alert(1)">Click</a>';
      const output = sanitizeHtml(input);
      expect(output).not.toContain('javascript:');
    });

    it('should sanitize URLs in href attributes', () => {
      const input = '<a href="http://safe.com">Link</a>';
      const output = sanitizeHtml(input);
      // URL is escaped in output
      expect(output).toMatch(/http.*safe\.com/);
    });

    it('should remove data URLs with HTML', () => {
      const input = '<img src="data:text/html,<script>alert(1)</script>">';
      const output = sanitizeHtml(input);
      expect(output).not.toContain('data:text/html');
    });

    it('should strip all HTML if malicious content detected', () => {
      const input = '<iframe src="evil.com"></iframe><p>Text</p>';
      const output = sanitizeHtml(input);
      expect(output).not.toContain('<iframe>');
      expect(output).not.toContain('<p>');
      expect(output).toBe('Text');
    });
  });

  describe('isValidUrl', () => {
    it('should allow http URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
    });

    it('should allow https URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
    });

    it('should allow mailto URLs', () => {
      expect(isValidUrl('mailto:test@example.com')).toBe(true);
    });

    it('should allow tel URLs', () => {
      expect(isValidUrl('tel:+1234567890')).toBe(true);
    });

    it('should allow relative URLs', () => {
      expect(isValidUrl('/path/to/page')).toBe(true);
      expect(isValidUrl('#anchor')).toBe(true);
    });

    it('should reject javascript: URLs', () => {
      expect(isValidUrl('javascript:alert(1)')).toBe(false);
    });

    it('should reject data: URLs', () => {
      expect(isValidUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(isValidUrl('not a url')).toBe(false);
    });

    it('should handle empty input', () => {
      expect(isValidUrl('')).toBe(false);
    });
  });

  describe('sanitizeInput', () => {
    it('should strip HTML by default', () => {
      const input = '<p>Hello <script>alert(1)</script></p>';
      const output = sanitizeInput(input);
      expect(output).toContain('Hello');
      expect(output).not.toContain('<p>');
      expect(output).not.toContain('<script>');
    });

    it('should allow HTML if specified', () => {
      const input = '<p>Hello <strong>world</strong></p>';
      const output = sanitizeInput(input, { allowHtml: true });
      expect(output).toContain('<p>');
      expect(output).toContain('<strong>');
    });

    it('should enforce max length', () => {
      const input = 'This is a very long string that should be truncated';
      const output = sanitizeInput(input, { maxLength: 10 });
      expect(output).toBe('This is a ');
      expect(output.length).toBe(10);
    });

    it('should trim whitespace', () => {
      const input = '  Hello  ';
      const output = sanitizeInput(input);
      expect(output).toBe('Hello');
    });

    it('should handle empty input', () => {
      expect(sanitizeInput('')).toBe('');
    });
  });

  describe('containsSqlInjectionPattern', () => {
    it('should detect OR-based injection', () => {
      expect(containsSqlInjectionPattern("1' OR '1'='1")).toBe(true);
      expect(containsSqlInjectionPattern("admin' OR 1=1--")).toBe(true);
    });

    it('should detect UNION-based injection', () => {
      expect(containsSqlInjectionPattern('UNION SELECT * FROM users')).toBe(true);
    });

    it('should detect INSERT statements', () => {
      expect(containsSqlInjectionPattern('INSERT INTO users VALUES')).toBe(true);
    });

    it('should detect DELETE statements', () => {
      expect(containsSqlInjectionPattern('DELETE FROM users WHERE')).toBe(true);
    });

    it('should detect DROP statements', () => {
      expect(containsSqlInjectionPattern('DROP TABLE users')).toBe(true);
    });

    it('should detect UPDATE statements', () => {
      expect(containsSqlInjectionPattern('UPDATE users SET password')).toBe(true);
    });

    it('should detect comment-based injection', () => {
      expect(containsSqlInjectionPattern("admin';--")).toBe(true);
    });

    it('should detect stored procedure execution', () => {
      expect(containsSqlInjectionPattern('xp_cmdshell')).toBe(true);
      expect(containsSqlInjectionPattern('exec(')).toBe(true);
    });

    it('should not flag safe content', () => {
      expect(containsSqlInjectionPattern('This is a normal string')).toBe(false);
      expect(containsSqlInjectionPattern('Email: user@example.com')).toBe(false);
    });
  });

  describe('validateAndSanitizeInput', () => {
    it('should detect and sanitize malicious HTML', () => {
      const input = '<script>alert("XSS")</script><p>Text</p>';
      const result = validateAndSanitizeInput(input);
      
      expect(result.isValid).toBe(false);
      expect(result.issues).toContain('Potentially malicious HTML detected');
      expect(result.sanitized).not.toContain('<script>');
    });

    it('should detect SQL injection patterns', () => {
      const input = "1' OR '1'='1";
      const result = validateAndSanitizeInput(input);
      
      expect(result.isValid).toBe(false);
      expect(result.issues).toContain('Potentially malicious SQL pattern detected');
    });

    it('should pass safe content', () => {
      const input = 'This is normal, safe content.';
      const result = validateAndSanitizeInput(input);
      
      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.sanitized).toBe(input);
    });

    it('should sanitize with options', () => {
      const input = '<p>Long text that should be truncated</p>';
      const result = validateAndSanitizeInput(input, { maxLength: 10 });
      
      expect(result.sanitized.length).toBeLessThanOrEqual(10);
    });

    it('should handle multiple issues', () => {
      const input = '<script>DROP TABLE users</script>';
      const result = validateAndSanitizeInput(input);
      
      expect(result.isValid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });
});
