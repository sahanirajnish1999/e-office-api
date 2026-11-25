import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import { appConfig } from '../config/app.config.js';
import { EmailTemplate } from '../models/email.template.model.js';
import { renderTemplateString } from './email.template.util.js';
import { htmlToPlainText } from './html.sanitizer.util.js';

let transporter = null;

const DEFAULT_TEMPLATE_FILES = {
  account_created: 'account-created.html',
  password_reset: 'password-reset.html',
  email_change: 'email-change.html',
  signature_otp: 'signature-otp.html',
};

const loadTemplateForEvent = async (eventKey) => {
  try {
    if (mongoose.connection?.readyState === 1) {
      const customTemplate = await EmailTemplate.findOne({ eventKey, isActive: true }).lean();
      if (customTemplate?.htmlFilePath) {
        const absPath = path.resolve(process.cwd(), customTemplate.htmlFilePath);
        if (fs.existsSync(absPath)) {
          return {
            subject: customTemplate.subject,
            html: fs.readFileSync(absPath, 'utf8'),
            text: customTemplate.textContent || '',
          };
        }
      }
    }
  } catch (err) {
    console.warn(`Failed to load custom template for ${eventKey}, falling back to default:`, err.message);
  }

  const defaultFile = DEFAULT_TEMPLATE_FILES[eventKey];
  if (defaultFile) {
    const defaultPath = path.resolve(process.cwd(), 'src/templates/emails', defaultFile);
    if (fs.existsSync(defaultPath)) {
      return {
        subject: null,
        html: fs.readFileSync(defaultPath, 'utf8'),
        text: '',
      };
    }
  }

  return null;
};

export const getMailTransporter = async () => {
  if (transporter) return transporter;

  if (
    process.env.NODE_ENV === 'test' ||
    process.env.npm_lifecycle_event === 'test' ||
    process.execArgv?.includes('--test') ||
    process.argv?.includes('--test')
  ) {
    transporter = {
      sendMail: async (mailOptions) => ({
        messageId: 'mock-test-message-id-' + Date.now(),
      }),
      verify: async () => true,
    };
    return transporter;
  }

  if (appConfig.smtp.user && appConfig.smtp.pass) {
    transporter = nodemailer.createTransport({
      host: appConfig.smtp.host,
      port: appConfig.smtp.port,
      auth: {
        user: appConfig.smtp.user,
        pass: appConfig.smtp.pass,
      },
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
  }

  return transporter;
};

export const sendMail = async ({ to, subject, text, html }) => {
  const mailer = await getMailTransporter();
  const info = await mailer.sendMail({
    from: '"Enterprise Management" <no-reply@example.com>',
    to,
    subject,
    text,
    html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`✉️ Email sent to ${to}. Preview: ${previewUrl}`);
  }

  return {
    messageId: info.messageId,
    previewUrl,
  };
};

/**
 * Send password reset verification email
 */
export const sendPasswordResetEmail = async (email, resetToken, host, context = {}) => {
  const resetUrl = `http://${host}/api/auth/reset-password/${resetToken}`;
  const variables = {
    email,
    'reset-token': resetToken,
    'reset-url': resetUrl,
    'ip-address': context.ipAddress || 'N/A',
    'sender-user-name': context.senderUserName || 'Enterprise Management System',
  };

  const loaded = await loadTemplateForEvent('password_reset');
  const subject = loaded?.subject
    ? renderTemplateString(loaded.subject, variables, { escapeHtmlValues: false })
    : 'Password Reset Verification';
  const html = loaded?.html
    ? renderTemplateString(loaded.html, variables, { escapeHtmlValues: true })
    : `<h2>Password Reset Request</h2><p>Reset Token: <code>${resetToken}</code></p>`;
  const text = loaded?.text
    ? renderTemplateString(loaded.text, variables, { escapeHtmlValues: false })
    : `You requested a password reset. Use this token to reset your password within 15 minutes: ${resetToken}\nOr POST to: ${resetUrl}`;

  return sendMail({ to: email, subject, text, html });
};

/**
 * Send email change decision notification
 */
export const sendEmailChangeNotification = async (
  recipientEmail,
  status,
  requestedEmail,
  note = '',
  context = {}
) => {
  const isApproved = status === 'approved';
  const statusLabel = isApproved ? 'Approved' : 'Rejected';
  const defaultMessage = isApproved
    ? `Your request to change your email address to ${requestedEmail} has been approved by the Super Admin.`
    : `Your request to change your email address to ${requestedEmail} was rejected by the Super Admin.${note ? ` Reason: ${note}` : ''}`;

  const variables = {
    email: recipientEmail,
    status: statusLabel,
    message: defaultMessage,
    remarks: note,
    'ip-address': context.ipAddress || 'N/A',
    'sender-user-name': context.senderUserName || 'Super Admin',
  };

  const loaded = await loadTemplateForEvent('email_change');
  const subject = loaded?.subject
    ? renderTemplateString(loaded.subject, variables, { escapeHtmlValues: false })
    : `Email Change Request ${statusLabel}`;
  const html = loaded?.html
    ? renderTemplateString(loaded.html, variables, { escapeHtmlValues: true })
    : `<h2>Email Change Request ${statusLabel}</h2><p>${defaultMessage}</p>`;
  const text = loaded?.text
    ? renderTemplateString(loaded.text, variables, { escapeHtmlValues: false })
    : defaultMessage;

  return sendMail({ to: recipientEmail, subject, text, html });
};

/**
 * Send welcome account creation email with login credentials
 */
export const sendAccountCreatedEmail = async ({
  email,
  name,
  userId,
  employeeId,
  password,
  role,
  departmentName,
  ipAddress,
  senderUserName,
}) => {
  const displayUserId = employeeId || (userId ? userId.toString() : email);
  const variables = {
    username: name || 'User',
    email,
    'user-id': displayUserId,
    password,
    role: role || 'User',
    department: departmentName || 'N/A',
    'ip-address': ipAddress || 'N/A',
    'sender-user-name': senderUserName || 'Enterprise Management System',
  };

  const loaded = await loadTemplateForEvent('account_created');
  const subject = loaded?.subject
    ? renderTemplateString(loaded.subject, variables, { escapeHtmlValues: false })
    : 'Your Account Has Been Created - Login Credentials';
  const html = loaded?.html
    ? renderTemplateString(loaded.html, variables, { escapeHtmlValues: true })
    : htmlToPlainText('');
  const text = loaded?.text
    ? renderTemplateString(loaded.text, variables, { escapeHtmlValues: false })
    : `Hello ${name || 'User'},\n\nYour account has been created successfully.\n\nHere are your login credentials:\nUser ID: ${displayUserId}\nLogin Email: ${email}\nPassword: ${password}\nRole: ${role || 'User'}${departmentName ? `\nDepartment: ${departmentName}` : ''}\n\nPlease keep your credentials secure and change your password after initial login.\n\nBest regards,\nEnterprise Management System`;

  return sendMail({ to: email, subject, text, html });
};

/**
 * Send digital signature verification OTP email
 */
export const sendSignatureOtpEmail = async (
  email,
  otp,
  documentTitle = 'Official Document',
  context = {}
) => {
  const variables = {
    email,
    otp,
    'document-title': documentTitle,
    'ip-address': context.ipAddress || 'N/A',
    'sender-user-name': context.senderUserName || 'Enterprise Management System',
  };

  const loaded = await loadTemplateForEvent('signature_otp');
  const subject = loaded?.subject
    ? renderTemplateString(loaded.subject, variables, { escapeHtmlValues: false })
    : `Digital Signature Verification OTP - ${documentTitle}`;
  const html = loaded?.html
    ? renderTemplateString(loaded.html, variables, { escapeHtmlValues: true })
    : `<h2>Digital Signature Verification</h2><p>OTP: <b>${otp}</b></p>`;
  const text = loaded?.text
    ? renderTemplateString(loaded.text, variables, { escapeHtmlValues: false })
    : `Your OTP to digitally sign the document "${documentTitle}" is: ${otp}. This code is valid for 10 minutes.\nIf you did not request this signature, please ignore this email.`;

  return sendMail({ to: email, subject, text, html });
};
