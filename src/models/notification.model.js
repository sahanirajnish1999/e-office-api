import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    // REMINDER TITLE / TASK *
    title: {
      type: String,
      required: [true, 'Reminder title / task is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },

    // FILE REFERENCE NUMBER (OPTIONAL - e.g. MOR/CIVIL/2026/F-001)
    fileReferenceNumber: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },

    // FILE REFERENCE ID (OPTIONAL - resolved ObjectId ref to Document)
    fileReferenceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      default: null,
      index: true,
    },

    // Notify date
    notifyDate: {
      type: Date,
      default: Date.now,
      index: true,
    },

    // PRIORITY
    priority: {
      type: String,
      enum: ['routine', 'urgent', 'immediate'],
      default: 'routine',
      lowercase: true,
      index: true,
    },

    // Broadcast: self, global, specific_user
    broadcast: {
      type: String,
      enum: ['self', 'global', 'specific_user'],
      default: 'self',
      lowercase: true,
      index: true,
    },

    // created by userid
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Creator user ID is required'],
      index: true,
    },

    // Single target user (used when broadcast is 'specific_user')
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    targetEmployeeId: {
      type: String,
      default: '',
      trim: true,
    },

    // message
    message: {
      type: String,
      default: '',
      trim: true,
    },

    // read count & unread count
    readCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    unreadCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // classification
    classification: {
      type: String,
      enum: {
        values: [
          'System Notice',
          'Workflow Directive',
          'Security & Compliance',
          'Official Reminder',
        ],
        message: '{VALUE} is not a valid classification',
      },
      required: [true, 'Classification is required'],
      index: true,
    },

    status: {
      type: String,
      enum: ['active', 'dismissed', 'archived'],
      default: 'active',
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
