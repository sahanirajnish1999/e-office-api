import mongoose from 'mongoose';

const notificationReadSchema = new mongoose.Schema(
  {
    notificationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Notification',
      required: [true, 'notificationId is required'],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      index: true,
    },
    readAt: {
      type: Date,
      default: Date.now,
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

// Compound unique index: guarantees a user can only record a read receipt once per notification
notificationReadSchema.index({ notificationId: 1, userId: 1 }, { unique: true });

export const NotificationRead = mongoose.model('NotificationRead', notificationReadSchema);
export default NotificationRead;
