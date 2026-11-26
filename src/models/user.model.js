import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { generateRandomToken, hashToken } from '../utils/crypto.util.js';
import { isValidPhone, normalizePhone } from '../utils/validator.util.js';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        'Please enter a valid email address',
      ],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: ['super_admin', 'ministry_admin', 'department_admin', 'employee'],
      default: 'employee',
    },
    ministryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ministry',
      default: null, // set for ministry_admin
      index: true,
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null, // super_admin and ministry_admin have null departmentId
    },
    employeeId: {
      type: String,
      trim: true,
      default: '',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
      set: (v) => (v ? normalizePhone(v) : ''),
      validate: {
        validator: function (v) {
          if (!v) return true;
          return isValidPhone(v);
        },
        message: 'Please provide a valid 10-digit mobile number or E.164 format (e.g. +919876543210)',
      },
    },
    designation: {
      type: String,
      trim: true,
      default: '',
    },
    isAuthorizedOfficer: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
    permissions: {
      canViewDashboard:       { type: Boolean, default: true },
      canViewMyFiles:         { type: Boolean, default: true },
      canCreateFile:          { type: Boolean, default: false },
      canUploadDocuments:     { type: Boolean, default: false },
      canCreateReplica:       { type: Boolean, default: true },
      canHighlightDocuments:  { type: Boolean, default: true },
      canAddRemarks:          { type: Boolean, default: true },
      canViewReceivedFiles:   { type: Boolean, default: true },
      canSearchFiles:         { type: Boolean, default: true },
      canAccessWorkspace:     { type: Boolean, default: true },
      canUseStickyNotes:      { type: Boolean, default: true },
      canAddOfficialNoting:   { type: Boolean, default: false },
      canApproveNoting:       { type: Boolean, default: false },
      canUseSpellingSynonyms: { type: Boolean, default: true },
      canManageReminders:     { type: Boolean, default: true },
      canViewNotifications:   { type: Boolean, default: true },
      canWithdrawFile:        { type: Boolean, default: false },
      canDeletePartial:       { type: Boolean, default: false },
      canDeletePermanent:     { type: Boolean, default: false },
      canViewApprovals:       { type: Boolean, default: false },
      canViewProfile:         { type: Boolean, default: true },
    },
    passwordResetToken: {
      type: String,
      select: false,
    },
    passwordResetExpires: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.password;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        delete ret.__v;
        // Expose joinedDate from createdAt
        if (ret.createdAt) {
          ret.joinedDate = ret.createdAt;
          delete ret.createdAt;
        }
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// Virtual aliases
userSchema.virtual('joinedDate').get(function () {
  return this.createdAt;
});
userSchema.virtual('lastActiveTime').get(function () {
  return this.lastActiveAt;
});

// Hash password before saving to database
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare entered password with hashed password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Generate and hash password reset token (valid for 15 minutes)
userSchema.methods.createPasswordResetToken = function () {
  const resetToken = generateRandomToken(32);
  this.passwordResetToken = hashToken(resetToken);
  this.passwordResetExpires = Date.now() + 15 * 60 * 1000; // 15 mins
  return resetToken;
};

// Indexes for fast lookups and aggregations
userSchema.index({ departmentId: 1, role: 1 });
userSchema.index(
  { phone: 1 },
  {
    unique: true,
    partialFilterExpression: { phone: { $type: 'string', $gt: '' } },
  }
);

export const User = mongoose.model('User', userSchema);
export default User;
