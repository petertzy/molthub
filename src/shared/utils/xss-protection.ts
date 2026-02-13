/**
 * XSS Protection Utilities
 * 
 * Provides HTML sanitization and input validation to prevent XSS attacks.
 * Uses a whitelist approach to allow safe HTML tags while removing potentially dangerous content.
 */

/**
 * HTML entities map for escaping
 */
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
};

/**
 * Escape HTML entities to prevent XSS
 * Use this for plain text content that should not contain any HTML
 */
export function escapeHtml(text: string): string {
  if (!text) return '';
  return text.replace(/[&<>"'/]/g, (char) => HTML_ENTITIES[char]);
}

/**
 * Unescape HTML entities
 */
export function unescapeHtml(text: string): string {
  if (!text) return '';
  
  const reverseMap: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#x27;': "'",
    '&#x2F;': '/',
  };

  return text.replace(/&(?:amp|lt|gt|quot|#x27|#x2F);/g, (entity) => reverseMap[entity] || entity);
}

/**
 * Detect potentially malicious patterns
 */
const MALICIOUS_PATTERNS = [
  /<script[\s>]/gi, // Script tag opening (case-insensitive)
  /<\/script>/gi, // Script tag closing
  /<iframe[\s>]/gi, // Iframe tag opening
  /<\/iframe>/gi, // Iframe tag closing  
  /javascript:/gi,
  /on\w+\s*=/gi, // onclick, onerror, onload, etc.
  /<object[\s>]/gi,
  /<embed[\s>]/gi,
  /<applet[\s>]/gi,
  /<meta[\s>]/gi,
  /<link[\s>]/gi,
  /<style[\s>]/gi,
  /<\/style>/gi,
  /vbscript:/gi,
  /data:text\/html/gi,
];

/**
 * Check if content contains potentially malicious patterns
 */
export function containsMaliciousContent(content: string): boolean {
  if (!content) return false;
  
  return MALICIOUS_PATTERNS.some(pattern => pattern.test(content));
}

/**
 * Strip all HTML tags from content
 * Use this when you want plain text only
 */
export function stripHtmlTags(content: string): string {
  if (!content) return '';
  
  // First pass: remove all tags
  let sanitized = content.replace(/<[^>]*>/g, '');
  
  // Second pass: decode HTML entities that might be hidden
  sanitized = sanitized.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  
  // Third pass: remove any remaining tags after decoding
  sanitized = sanitized.replace(/<[^>]*>/g, '');
  
  // Normalize whitespace
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  
  return sanitized;
}

/**
 * Sanitize HTML content by removing dangerous tags and attributes
 * Uses multiple passes to handle nested/encoded content
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';

  // First check for malicious patterns
  if (containsMaliciousContent(html)) {
    // If malicious content detected, strip all HTML
    return stripHtmlTags(html);
  }

  let sanitized = html;

  // Multiple passes to handle nested/encoded content
  for (let i = 0; i < 3; i++) {
    // Remove script tags and content (multiple patterns)
    sanitized = sanitized.replace(/<script[\s\S]*?<\/script>/gis, '');
    sanitized = sanitized.replace(/<script[^>]*>/gi, '');
    sanitized = sanitized.replace(/<\/script>/gi, '');
    
    // Remove style tags and content (multiple patterns)
    sanitized = sanitized.replace(/<style[\s\S]*?<\/style>/gis, '');
    sanitized = sanitized.replace(/<style[^>]*>/gi, '');
    sanitized = sanitized.replace(/<\/style>/gi, '');
    
    // Remove event handlers (multiple patterns)
    sanitized = sanitized.replace(/\son[a-z]+\s*=\s*["'][^"']*["']/gi, '');
    sanitized = sanitized.replace(/\son[a-z]+\s*=\s*[^\s>]*/gi, '');
    sanitized = sanitized.replace(/\s+on[a-z]+\s*=/gi, ' '); // Extra cleanup

    // Remove javascript: and vbscript: protocols
    sanitized = sanitized.replace(/javascript\s*:/gi, 'blocked:');
    sanitized = sanitized.replace(/vbscript\s*:/gi, 'blocked:');

    // Remove data URLs that could contain HTML
    sanitized = sanitized.replace(/data\s*:\s*text\s*\/\s*html[^"'\s]*/gi, 'blocked:');
  }

  // Validate and sanitize URLs in href and src attributes
  sanitized = sanitized.replace(/href\s*=\s*["']([^"']*)["']/gi, (match, url) => {
    if (isValidUrl(url)) {
      return `href="${escapeHtml(url)}"`;
    }
    return 'href="blocked:"';
  });

  sanitized = sanitized.replace(/src\s*=\s*["']([^"']*)["']/gi, (match, url) => {
    if (isValidUrl(url)) {
      return `src="${escapeHtml(url)}"`;
    }
    return 'src="blocked:"';
  });

  return sanitized;
}

/**
 * Allowed URL protocols for links and images
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * Validate URL to ensure it uses allowed protocols
 * Handles data: URIs more carefully
 */
export function isValidUrl(url: string): boolean {
  if (!url) return false;

  try {
    // Check for relative URLs (allowed)
    if (url.startsWith('/') && !url.startsWith('//')) {
      return true;
    }
    
    if (url.startsWith('#')) {
      return true;
    }

    // Block data: URIs completely for security
    if (url.toLowerCase().startsWith('data:')) {
      return false;
    }

    // Block javascript: and vbscript:
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.startsWith('javascript:') || lowerUrl.startsWith('vbscript:')) {
      return false;
    }

    const parsed = new URL(url);
    return ALLOWED_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Sanitize user input for different content types
 */
export interface SanitizeOptions {
  allowHtml?: boolean; // Allow safe HTML tags
  maxLength?: number; // Maximum length
  stripTags?: boolean; // Strip all HTML tags
}

export function sanitizeInput(input: string, options: SanitizeOptions = {}): string {
  if (!input) return '';

  const {
    allowHtml = false,
    maxLength,
    stripTags = false,
  } = options;

  let sanitized = input;

  // Strip tags if requested or if HTML not allowed
  if (stripTags || !allowHtml) {
    sanitized = stripHtmlTags(sanitized);
  } else {
    // Sanitize HTML if allowed
    sanitized = sanitizeHtml(sanitized);
  }

  // Trim whitespace
  sanitized = sanitized.trim();

  // Apply length limit
  if (maxLength && sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

/**
 * Detect SQL injection patterns (additional layer of defense)
 * Note: This is not a replacement for parameterized queries
 */
export function containsSqlInjectionPattern(input: string): boolean {
  if (!input) return false;

  const sqlPatterns = [
    /(\bOR\b|\bAND\b).*[=<>]/i,
    /UNION.*SELECT/i,
    /INSERT.*INTO/i,
    /DELETE.*FROM/i,
    /DROP.*TABLE/i,
    /UPDATE.*SET/i,
    /;.*--/,
    /\/\*.*\*\//,
    /xp_cmdshell/i,
    /exec\s*\(/i,
  ];

  return sqlPatterns.some(pattern => pattern.test(input));
}

/**
 * Comprehensive input validation and sanitization
 */
export function validateAndSanitizeInput(input: string, options: SanitizeOptions = {}): {
  sanitized: string;
  isValid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  
  // Check for malicious content
  if (containsMaliciousContent(input)) {
    issues.push('Potentially malicious HTML detected');
  }

  // Check for SQL injection patterns (defense in depth)
  if (containsSqlInjectionPattern(input)) {
    issues.push('Potentially malicious SQL pattern detected');
  }

  // Sanitize the input
  const sanitized = sanitizeInput(input, options);

  return {
    sanitized,
    isValid: issues.length === 0,
    issues,
  };
}
