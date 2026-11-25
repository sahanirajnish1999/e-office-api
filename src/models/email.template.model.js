import mongoose from 'mongoose';

export const EMAIL_EVENT_KEYS = [
  'account_created',
  'password_reset',
  'email_change',
  'signature_otp',
  'document_forwarded',
  'custom',
];

const emailTemplateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    eventKey: {
      type: String,
      enum: EMAIL_EVENT_KEYS,
      default: 'custom',
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    htmlFilePath: {
      type: String,
      required: true,
      trim: true,
    },
    textContent: {
      type: String,
      default: '',
    },
    placeholders: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: false,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

emailTemplateSchema.index({ eventKey: 1, isActive: 1 });

export const EmailTemplate = mongoose.model('EmailTemplate', emailTemplateSchema);
