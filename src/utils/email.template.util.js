import { appConfig } from '../config/app.config.js';

export const EMAIL_TEMPLATE_VARIABLES = [
  {
    key: 'username',
    syntax: ['{{username}}', '[username]'],
    description: 'Recipient full name',
    example: 'Ankit Kashyap',
  },
  {
    key: 'email',
    syntax: ['{{email}}', '[email]'],
    description: 'Recipient email address',
    example: 'ankit@example.com',
  },
  {
    key: 'ip address',
    syntax: ['{{ip address}}', '[ip address]', '{{ip-address}}'],
    description: 'Client IP address where the action originated',
    example: '192.168.1.45',
  },
  {
    key: 'organization-logo-image',
    syntax: ['{{organization-logo-image}}', '[organization-logo-image]'],
    description: 'Organization logo image URL (configured via ORG_LOGO_URL or passed dynamically)',
    example: 'https://example.com/logo.png',
  },
  {
    key: 'sender-user-name',
    syntax: ['{{sender-user-name}}', '[sender-user-name]'],
    description: 'Name of the sender or administrator triggering the email',
    example: 'System Administrator',
  },
  {
    key: 'current-date',
    syntax: ['{{current-date}}', '[current-date]'],
    description: 'Formatted current date/time',
    example: '25 Nov 2026',
  },
  {
    key: 'user-id',
    syntax: ['{{user-id}}', '[user-id]'],
    description: 'Employee ID or User ID (Account Created emails)',
    example: 'MOR/ENG/045',
  },
  {
    key: 'password',
    syntax: ['{{password}}', '[password]'],
    description: 'Initial temporary password (Account Created emails)',
    example: 'TempPass@123',
  },
  {
    key: 'role',
    syntax: ['{{role}}', '[role]'],
    description: 'Assigned user role',
    example: 'employee',
  },
  {
    key: 'department',
    syntax: ['{{department}}', '[department]'],
    description: 'Assigned department name',
    example: 'Engineering',
  },
  {
    key: 'reset-token',
    syntax: ['{{reset-token}}', '[reset-token]'],
    description: 'Password reset token (Password Reset emails)',
    example: 'a1b2c3d4e5f6',
  },
  {
    key: 'reset-url',
    syntax: ['{{reset-url}}', '[reset-url]'],
    description: 'Full password reset endpoint URL',
    example: 'http://localhost:3000/api/auth/reset-password/a1b2c3d4e5f6',
  },
  {
    key: 'otp',
    syntax: ['{{otp}}', '[otp]'],
    description: '6-digit verification OTP (Digital Signature emails)',
    example: '482910',
  },
  {
    key: 'document-title',
    syntax: ['{{document-title}}', '[document-title]'],
    description: 'Document title (Signature OTP / Document emails)',
    example: 'Track Modernization Sanction',
  },
  {
    key: 'status',
    syntax: ['{{status}}', '[status]'],
    description: 'Decision status (Email Change Request emails)',
    example: 'Approved',
  },
  {
    key: 'message',
    syntax: ['{{message}}', '[message]'],
    description: 'Contextual body message (Email Change Request / Custom emails)',
    example: 'Your email change request has been approved.',
  },
  {
    key: 'remarks',
    syntax: ['{{remarks}}', '[remarks]'],
    description: 'Optional remarks or note',
    example: 'Please review urgently',
  },
];

export const normalizePlaceholderKey = (rawKey = '') =>
  String(rawKey)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[\s_]+/g, '-');

export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const isSafeLogoUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  return /^https?:\/\/[^\s"'<>]+$/i.test(url.trim());
};

/**
 * Extract normalized placeholder keys from {{key}}, [[key]], or [key].
 */
export const extractPlaceholders = (content = '') => {
  const found = new Set();
  const pattern = /\{\{\s*([a-zA-Z0-9 _-]+?)\s*\}\}|\[\[\s*([a-zA-Z0-9 _-]+?)\s*\]\]|\[\s*([a-zA-Z0-9 _-]+?)\s*\]/g;
  let match;
  while ((match = pattern.exec(String(content))) !== null) {
    const raw = match[1] || match[2] || match[3];
    if (raw) {
      found.add(normalizePlaceholderKey(raw));
    }
  }
  return [...found];
};

/**
 * Render a template string by substituting {{key}}, [[key]], and [key] placeholders.
 */
export const renderTemplateString = (template = '', variables = {}, { escapeHtmlValues = true } = {}) => {
  const formattedDate = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const normalizedVars = {
    'current-date': formattedDate,
    'sender-user-name': 'Enterprise Management System',
    'ip-address': 'N/A',
    'organization-logo-image': isSafeLogoUrl(appConfig.orgLogoUrl) ? appConfig.orgLogoUrl : '',
  };

  for (const [key, value] of Object.entries(variables || {})) {
    if (value !== undefined && value !== null) {
      const normalized = normalizePlaceholderKey(key);
      if (normalized === 'organization-logo-image') {
        normalizedVars[normalized] = isSafeLogoUrl(String(value)) ? String(value).trim() : '';
      } else {
        normalizedVars[normalized] = String(value);
      }
    }
  }

  // Alias support: user-name <-> username, ip <-> ip-address
  if (normalizedVars['username'] && !normalizedVars['user-name']) {
    normalizedVars['user-name'] = normalizedVars['username'];
  } else if (normalizedVars['user-name'] && !normalizedVars['username']) {
    normalizedVars['username'] = normalizedVars['user-name'];
  }
  if (normalizedVars['ip'] && !normalizedVars['ip-address']) {
    normalizedVars['ip-address'] = normalizedVars['ip'];
  }

  const pattern = /\{\{\s*([a-zA-Z0-9 _-]+?)\s*\}\}|\[\[\s*([a-zA-Z0-9 _-]+?)\s*\]\]|\[\s*([a-zA-Z0-9 _-]+?)\s*\]/g;

  return String(template).replace(pattern, (fullMatch, g1, g2, g3) => {
    const rawKey = g1 || g2 || g3;
    const key = normalizePlaceholderKey(rawKey);
    if (!(key in normalizedVars)) {
      return '';
    }
    const val = normalizedVars[key];
    return escapeHtmlValues ? escapeHtml(val) : val;
  });
};
