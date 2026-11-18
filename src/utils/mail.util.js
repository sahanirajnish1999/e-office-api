import nodemailer from 'nodemailer';
import { appConfig } from '../config/app.config.js';

let transporter = null;

export const getMailTransporter = async () => {
  if (transporter) return transporter;

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
export const sendPasswordResetEmail = async (email, resetToken, host) => {
  const resetUrl = `http://${host}/api/auth/reset-password/${resetToken}`;

  const text = `You requested a password reset. Use this token to reset your password within 15 minutes: ${resetToken}\nOr POST to: ${resetUrl}`;
  const html = `
    <h2>Password Reset Request</h2>
    <p>You recently requested to reset your password. Use the token below or send a POST request with your new password.</p>
    <p><b>Reset Token:</b> <code>${resetToken}</code></p>
    <p>This token is valid for 15 minutes.</p>
    <p>If you did not request this, please ignore this email.</p>
  `;

  return sendMail({
    to: email,
    subject: 'Password Reset Verification',
    text,
    html,
  });
};

/**
 * Send email change decision notification
 */
export const sendEmailChangeNotification = async (recipientEmail, status, requestedEmail, note = '') => {
  const isApproved = status === 'approved';
  const subject = `Email Change Request ${isApproved ? 'Approved' : 'Rejected'}`;
  const text = isApproved
    ? `Your request to change your email address to ${requestedEmail} has been approved by the Super Admin.`
    : `Your request to change your email address to ${requestedEmail} was rejected by the Super Admin.${note ? ` Reason: ${note}` : ''}`;

  const html = `
    <h2>Email Change Request ${isApproved ? 'Approved ✅' : 'Rejected ❌'}</h2>
    <p>${text}</p>
  `;

  return sendMail({
    to: recipientEmail,
    subject,
    text,
    html,
  });
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
}) => {
  const displayUserId = employeeId || (userId ? userId.toString() : email);
  const subject = 'Your Account Has Been Created - Login Credentials';
  const text = `Hello ${name || 'User'},\n\nYour account has been created successfully.\n\nHere are your login credentials:\nUser ID: ${displayUserId}\nLogin Email: ${email}\nPassword: ${password}\nRole: ${role || 'User'}${departmentName ? `\nDepartment: ${departmentName}` : ''}\n\nPlease keep your credentials secure and change your password after initial login.\n\nBest regards,\nEnterprise Management System`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #1a365d; color: #ffffff; padding: 20px; text-align: center;">
        <h2 style="margin: 0;">Account Created Successfully</h2>
      </div>
      <div style="padding: 24px;">
        <p>Dear <b>${name || 'User'}</b>,</p>
        <p>Welcome! Your official account has been created. Below are your account details and login credentials:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background-color: #f7fafc; border-radius: 6px; overflow: hidden;">
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7; font-weight: bold; width: 35%;">User ID:</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7;"><code style="background: #edf2f7; padding: 2px 6px; border-radius: 4px; font-size: 14px;">${displayUserId}</code></td>
          </tr>
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7; font-weight: bold;">Login Email:</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7;">${email}</td>
          </tr>
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7; font-weight: bold;">Password:</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7;"><code style="background: #edf2f7; padding: 2px 6px; border-radius: 4px; font-size: 14px; font-weight: bold; color: #c53030;">${password}</code></td>
          </tr>
          ${role ? `<tr><td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7; font-weight: bold;">Role:</td><td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7;">${role}</td></tr>` : ''}
          ${departmentName ? `<tr><td style="padding: 12px 16px; font-weight: bold;">Department:</td><td style="padding: 12px 16px;">${departmentName}</td></tr>` : ''}
        </table>
        <div style="background-color: #fffaf0; border-left: 4px solid #dd6b20; padding: 12px; margin: 16px 0; font-size: 13px; color: #7b341e;">
          <b>Security Notice:</b> Please keep your password confidential and consider changing it upon your initial login.
        </div>
        <p style="margin-top: 24px; font-size: 13px; color: #718096;">If you believe this account was created in error, please contact your administrator immediately.</p>
      </div>
    </div>
  `;

  return sendMail({
    to: email,
    subject,
    text,
    html,
  });
};
