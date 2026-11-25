import fs from 'node:fs';
import path from 'node:path';
import { EmailTemplate, EMAIL_EVENT_KEYS } from '../models/email.template.model.js';
import { appConfig } from '../config/app.config.js';
import { validateAndSanitizeEmailHtml, htmlToPlainText } from '../utils/html.sanitizer.util.js';
import {
  EMAIL_TEMPLATE_VARIABLES,
  extractPlaceholders,
  renderTemplateString,
} from '../utils/email.template.util.js';
import { sendMail } from '../utils/mail.util.js';

const getTemplatesStorageDir = () => {
  const dir = path.resolve(process.cwd(), appConfig.uploadDir, 'email-templates');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const getDefaultTemplatesDir = () => path.resolve(process.cwd(), 'src/templates/emails');

const slugify = (str = 'template') =>
  String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'template';

const resolveTemplateFilePath = (relativeOrStoredPath) => {
  const baseDir = getTemplatesStorageDir();
  const resolved = path.resolve(process.cwd(), relativeOrStoredPath);
  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    throw new Error('Invalid email template file path');
  }
  return resolved;
};

const extractIncomingHtml = (req) => {
  if (req.file?.buffer) {
    return req.file.buffer.toString('utf8');
  }
  return req.body?.html || '';
};

const parseBoolean = (val) => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true';
  return false;
};

/**
 * GET /api/email-templates/variables
 * List all supported placeholders and default built-in templates for Super Admin reference.
 */
export const getTemplateVariablesAndDefaults = async (req, res, next) => {
  try {
    const defaultDir = getDefaultTemplatesDir();
    const defaultFiles = {};
    if (fs.existsSync(defaultDir)) {
      for (const file of fs.readdirSync(defaultDir)) {
        if (file.endsWith('.html')) {
          const key = file.replace('.html', '').replace(/-/g, '_');
          defaultFiles[key] = fs.readFileSync(path.join(defaultDir, file), 'utf8');
        }
      }
    }

    res.status(200).json({
      success: true,
      data: {
        supportedSyntax: ['{{variable}}', '[[variable]]', '[variable]'],
        eventKeys: EMAIL_EVENT_KEYS,
        variables: EMAIL_TEMPLATE_VARIABLES,
        defaultTemplates: defaultFiles,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/email-templates
 * Create and store a sanitized HTML email template (JSON html body or .html file upload).
 */
export const createEmailTemplate = async (req, res, next) => {
  try {
    const { name, eventKey = 'custom', subject, textContent } = req.body || {};
    const rawHtml = extractIncomingHtml(req);

    if (!name || !subject || !rawHtml) {
      return res.status(400).json({
        success: false,
        message: 'Template name, subject, and HTML content (body.html or .html file) are required',
      });
    }

    if (!EMAIL_EVENT_KEYS.includes(eventKey)) {
      return res.status(400).json({
        success: false,
        message: `Invalid eventKey. Allowed values: ${EMAIL_EVENT_KEYS.join(', ')}`,
      });
    }

    const { valid, sanitizedHtml, violations } = validateAndSanitizeEmailHtml(rawHtml);
    if (!valid) {
      return res.status(400).json({
        success: false,
        message: 'HTML template rejected due to unsafe or disallowed markup/scripts',
        violations,
      });
    }

    const storageDir = getTemplatesStorageDir();
    const fileName = `${slugify(eventKey)}-${slugify(name)}-${Date.now()}.html`;
    const absPath = path.join(storageDir, fileName);
    fs.writeFileSync(absPath, sanitizedHtml, 'utf8');

    const relativePath = path.relative(process.cwd(), absPath);
    const shouldActivate = parseBoolean(req.body?.isActive);

    if (shouldActivate && eventKey !== 'custom') {
      await EmailTemplate.updateMany({ eventKey, isActive: true }, { isActive: false });
    }

    const placeholders = extractPlaceholders(`${subject} ${sanitizedHtml} ${textContent || ''}`);
    const finalText = textContent?.trim() ? textContent.trim() : htmlToPlainText(sanitizedHtml);

    const template = await EmailTemplate.create({
      name: name.trim(),
      eventKey,
      subject: subject.trim(),
      htmlFilePath: relativePath,
      textContent: finalText,
      placeholders,
      isActive: shouldActivate,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: 'Email template created and sanitized successfully',
      data: template,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/email-templates
 */
export const listEmailTemplates = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.eventKey) filter.eventKey = req.query.eventKey;
    if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';

    const templates = await EmailTemplate.find(filter).sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      data: templates,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/email-templates/:id
 */
export const getEmailTemplateById = async (req, res, next) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Email template not found' });
    }

    let htmlContent = '';
    try {
      const absPath = resolveTemplateFilePath(template.htmlFilePath);
      if (fs.existsSync(absPath)) {
        htmlContent = fs.readFileSync(absPath, 'utf8');
      }
    } catch {
      htmlContent = '';
    }

    res.status(200).json({
      success: true,
      data: {
        ...template.toObject(),
        htmlContent,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/email-templates/:id
 */
export const updateEmailTemplate = async (req, res, next) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Email template not found' });
    }

    const { name, eventKey, subject, textContent } = req.body || {};
    const rawHtml = extractIncomingHtml(req);

    if (eventKey && !EMAIL_EVENT_KEYS.includes(eventKey)) {
      return res.status(400).json({
        success: false,
        message: `Invalid eventKey. Allowed values: ${EMAIL_EVENT_KEYS.join(', ')}`,
      });
    }

    let currentHtml = '';
    const existingAbsPath = resolveTemplateFilePath(template.htmlFilePath);
    if (fs.existsSync(existingAbsPath)) {
      currentHtml = fs.readFileSync(existingAbsPath, 'utf8');
    }

    if (rawHtml) {
      const { valid, sanitizedHtml, violations } = validateAndSanitizeEmailHtml(rawHtml);
      if (!valid) {
        return res.status(400).json({
          success: false,
          message: 'HTML template rejected due to unsafe or disallowed markup/scripts',
          violations,
        });
      }
      fs.writeFileSync(existingAbsPath, sanitizedHtml, 'utf8');
      currentHtml = sanitizedHtml;
    }

    if (name) template.name = name.trim();
    if (eventKey) template.eventKey = eventKey;
    if (subject) template.subject = subject.trim();
    if (textContent !== undefined) {
      template.textContent = textContent.trim() || htmlToPlainText(currentHtml);
    } else if (rawHtml && !template.textContent) {
      template.textContent = htmlToPlainText(currentHtml);
    }

    if (req.body?.isActive !== undefined) {
      const activate = parseBoolean(req.body.isActive);
      if (activate && template.eventKey !== 'custom') {
        await EmailTemplate.updateMany(
          { eventKey: template.eventKey, _id: { $ne: template._id }, isActive: true },
          { isActive: false }
        );
      }
      template.isActive = activate;
    }

    template.placeholders = extractPlaceholders(
      `${template.subject} ${currentHtml} ${template.textContent}`
    );
    template.updatedBy = req.user._id;
    await template.save();

    res.status(200).json({
      success: true,
      message: 'Email template updated successfully',
      data: template,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/email-templates/:id/activate
 */
export const activateEmailTemplate = async (req, res, next) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Email template not found' });
    }

    if (template.eventKey !== 'custom') {
      await EmailTemplate.updateMany(
        { eventKey: template.eventKey, _id: { $ne: template._id }, isActive: true },
        { isActive: false }
      );
    }

    template.isActive = true;
    template.updatedBy = req.user._id;
    await template.save();

    res.status(200).json({
      success: true,
      message: `Template activated for event '${template.eventKey}'`,
      data: template,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/email-templates/:id/preview
 */
export const previewEmailTemplate = async (req, res, next) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Email template not found' });
    }

    const absPath = resolveTemplateFilePath(template.htmlFilePath);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ success: false, message: 'Template HTML file missing on disk' });
    }

    const rawHtml = fs.readFileSync(absPath, 'utf8');
    const sampleVars = {};
    for (const item of EMAIL_TEMPLATE_VARIABLES) {
      sampleVars[item.key] = item.example;
    }

    const mergedVars = {
      ...sampleVars,
      'ip-address': req.ip || '127.0.0.1',
      'sender-user-name': req.user?.name || 'Super Admin',
      ...(req.body?.variables || {}),
    };

    const renderedSubject = renderTemplateString(template.subject, mergedVars, {
      escapeHtmlValues: false,
    });
    const renderedHtml = renderTemplateString(rawHtml, mergedVars, {
      escapeHtmlValues: true,
    });
    const renderedText = renderTemplateString(
      template.textContent || htmlToPlainText(rawHtml),
      mergedVars,
      { escapeHtmlValues: false }
    );

    res.status(200).json({
      success: true,
      data: {
        subject: renderedSubject,
        html: renderedHtml,
        text: renderedText,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/email-templates/:id/send-test
 */
export const sendTestTemplateEmail = async (req, res, next) => {
  try {
    const { to, variables = {} } = req.body || {};
    if (!to) {
      return res.status(400).json({ success: false, message: 'Recipient email (to) is required' });
    }

    const template = await EmailTemplate.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Email template not found' });
    }

    const absPath = resolveTemplateFilePath(template.htmlFilePath);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ success: false, message: 'Template HTML file missing on disk' });
    }

    const rawHtml = fs.readFileSync(absPath, 'utf8');
    const mergedVars = {
      email: to,
      'ip-address': req.ip || 'N/A',
      'sender-user-name': req.user?.name || 'Super Admin',
      ...variables,
    };

    const subject = renderTemplateString(template.subject, mergedVars, { escapeHtmlValues: false });
    const html = renderTemplateString(rawHtml, mergedVars, { escapeHtmlValues: true });
    const text = renderTemplateString(
      template.textContent || htmlToPlainText(rawHtml),
      mergedVars,
      { escapeHtmlValues: false }
    );

    const result = await sendMail({ to, subject, text, html });

    res.status(200).json({
      success: true,
      message: 'Test template email sent successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/email-templates/:id
 */
export const deleteEmailTemplate = async (req, res, next) => {
  try {
    const template = await EmailTemplate.findByIdAndDelete(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Email template not found' });
    }

    try {
      const absPath = resolveTemplateFilePath(template.htmlFilePath);
      if (fs.existsSync(absPath)) {
        fs.unlinkSync(absPath);
      }
    } catch {
      // Ignore missing/invalid path cleanup
    }

    res.status(200).json({
      success: true,
      message: 'Email template deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
