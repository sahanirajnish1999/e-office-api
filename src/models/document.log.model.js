import mongoose from 'mongoose';

const documentLogSchema = new mongoose.Schema(
  {
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true,
    },
    fileNumber: {
      type: String,
      trim: true,
      default: '',
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    userName: {
      type: String,
      required: true,
    },
    userRole: {
      type: String,
      required: true,
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null,
      index: true,
    },
    departmentName: {
      type: String,
      trim: true,
      default: '',
    },
    action: {
      type: String,
      required: true,
    },
    details: {
      type: String,
      default: '',
    },
    ipAddress: {
      type: String,
      default: '127.0.0.1',
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    toJSON: {
      transform: (doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Indexes for fast filtering and high-speed timeline sorting
documentLogSchema.index({ timestamp: -1 });
documentLogSchema.index({ departmentId: 1, timestamp: -1 });
documentLogSchema.index({ userId: 1, timestamp: -1 });

export const DocumentLog = mongoose.model('DocumentLog', documentLogSchema);
export default DocumentLog;
