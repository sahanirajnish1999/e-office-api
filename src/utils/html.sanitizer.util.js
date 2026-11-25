const SAFE_EMAIL_TAGS = new Set([
  'html',
  'head',
  'body',
  'title',
  'style',
  'div',
  'span',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'colgroup',
  'col',
  'a',
  'img',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'small',
  'big',
  'sub',
  'sup',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'blockquote',
  'code',
  'pre',
  'center',
  'font',
  'section',
  'header',
  'footer',
  'main',
  'article',
]);

const DANGEROUS_TAGS = new Set([
  'script',
  'noscript',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'meta',
  'link',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'svg',
  'math',
  'template',
]);

const decodeNumericEntities = (str) =>
  str
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);?/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });

/**
 * Validate and sanitize Super Admin supplied HTML email templates.
 * Strictly blocks JavaScript, event handlers, dangerous URI schemes,
 * unsafe CSS expressions, and non-email active tags.
 */
export const validateAndSanitizeEmailHtml = (rawHtml) => {
  if (typeof rawHtml !== 'string' || !rawHtml.trim()) {
    return {
      valid: false,
      sanitizedHtml: '',
      violations: ['HTML content must be a non-empty string'],
    };
  }

  const violations = [];
  // Strip null bytes and HTML comments to prevent parser/comment smuggling
  const cleaned = rawHtml.replace(/\u0000/g, '').replace(/<!--[\s\S]*?-->/g, '');

  // Decode entities on a shadow copy to catch obfuscated payloads (e.g. &#x6a;avascript:)
  const decodedShadow = decodeNumericEntities(cleaned);
  const compactShadow = decodedShadow.replace(/[\s\u0000-\u001f]+/g, '');

  // 1. Check all HTML tags against allowlist / blocklist
  const tagRegex = /<\s*\/?\s*([a-zA-Z0-9:-]+)(?:\s[^>]*)?>/g;
  for (const source of [cleaned, decodedShadow]) {
    let match;
    tagRegex.lastIndex = 0;
    while ((match = tagRegex.exec(source)) !== null) {
      const tagName = match[1].toLowerCase();
      if (DANGEROUS_TAGS.has(tagName)) {
        violations.push(`Disallowed or unsafe HTML tag detected: <${tagName}>`);
      } else if (!SAFE_EMAIL_TAGS.has(tagName)) {
        violations.push(`Unsupported HTML tag detected: <${tagName}>`);
      }
    }
  }

  // 2. Check for inline JavaScript event handlers (on*=) and dangerous attributes
  const eventHandlerRegex = /\s(on[a-z0-9_-]+|srcdoc|formaction|xlink:href)\s*=/gi;
  for (const source of [cleaned, decodedShadow]) {
    let match;
    eventHandlerRegex.lastIndex = 0;
    while ((match = eventHandlerRegex.exec(source)) !== null) {
      violations.push(`Disallowed inline script/event attribute detected: ${match[1].toLowerCase()}`);
    }
  }

  // 3. Check for dangerous URI schemes (javascript:, vbscript:, data:text/html, data:image/svg+xml, file:)
  const dangerousSchemeRegex = /(javascript|vbscript|file)\s*:|data\s*:\s*(text\/html|application\/|image\/svg\+xml)/i;
  if (dangerousSchemeRegex.test(cleaned) || dangerousSchemeRegex.test(decodedShadow) || dangerousSchemeRegex.test(compactShadow)) {
    violations.push('Disallowed URI protocol detected (javascript:, vbscript:, file:, or unsafe data: URI)');
  }

  // 4. Check for dangerous CSS constructs in style attributes or <style> blocks
  const dangerousCssRegex = /(expression\s*\(|behavior\s*:|-moz-binding\s*:|@import\b)/i;
  if (dangerousCssRegex.test(cleaned) || dangerousCssRegex.test(decodedShadow)) {
    violations.push('Disallowed CSS expression or @import rule detected');
  }

  const uniqueViolations = [...new Set(violations)];

  return {
    valid: uniqueViolations.length === 0,
    sanitizedHtml: uniqueViolations.length === 0 ? cleaned.trim() : '',
    violations: uniqueViolations,
  };
};

/**
 * Convert safe HTML into a readable plain-text fallback for email clients.
 */
export const htmlToPlainText = (html = '') => {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
