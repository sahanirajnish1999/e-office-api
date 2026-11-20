import { User } from '../models/user.model.js';
import { generateToken } from '../utils/token.util.js';
import { hashToken } from '../utils/crypto.util.js';
import { sendPasswordResetEmail, sendAccountCreatedEmail } from '../utils/mail.util.js';
import { generateNextEmployeeId } from '../utils/user.util.js';
import { isValidEmail, normalizeEmail, isValidPhone, normalizePhone } from '../utils/validator.util.js';

export const register = async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address (e.g. user@example.com)',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
      });
    }

    if (phone && !isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid 10-digit mobile number',
      });
    }

    const normalizedEmail = normalizeEmail(email);

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User already exists with this email',
      });
    }

    // Only allow registering the initial Super Admin; further registrations are disabled
    const userCount = await User.countDocuments();

    if (userCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Super admin already exists. Direct public registration is disabled.',
      });
    }

    const assignedRole = 'super_admin';

    // Auto-generate Super Admin employee ID with code 'HQ' (e.g. "MOR/HQ/001")
    let finalEmployeeId = (req.body.employeeId || '').trim().toUpperCase();
    if (!finalEmployeeId) {
      finalEmployeeId = await generateNextEmployeeId(null, 'HQ');
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: assignedRole,
      employeeId: finalEmployeeId,
      phone: phone ? normalizePhone(phone) : '',
    });

    // Send account creation email with login credentials
    try {
      await sendAccountCreatedEmail({
        email: user.email,
        name: user.name,
        userId: user._id,
        employeeId: user.employeeId,
        password,
        role: user.role,
      });
    } catch (mailError) {
      console.error('Failed to send welcome email to Super Admin:', mailError.message);
    }

    const token = generateToken({
      id: user._id,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
    });

    res.status(201).json({
      success: true,
      message: `User registered successfully as ${user.role}`,
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const user = await User.findOne({ email: normalizedEmail }).select('+password').populate('departmentId', 'name code');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const token = generateToken({
      id: user._id,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId ? user.departmentId._id : null,
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Initiate password reset via email verification
 */
export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your email address',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      // Return 200 to prevent email enumeration attack
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, a password reset token has been sent.',
      });
    }

    // Generate reset token and save hashed token to database
    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    // Send verification email
    try {
      const emailResult = await sendPasswordResetEmail(user.email, resetToken, req.get('host'));
      res.status(200).json({
        success: true,
        message: 'Password reset token sent to your email',
        previewUrl: emailResult.previewUrl, // Provided for Ethereal email testing
      });
    } catch (mailError) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });

      return res.status(500).json({
        success: false,
        message: 'Error sending email. Please try again later.',
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Verify token and set new password
 */
export const resetPassword = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: 'Reset token and new password are required',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters',
      });
    }

    // Hash provided token to match stored hash
    const hashed = hashToken(token);

    const user = await User.findOne({
      passwordResetToken: hashed,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Token is invalid or has expired',
      });
    }

    // Set new password
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now login with your new password.',
    });
  } catch (error) {
    next(error);
  }
};
