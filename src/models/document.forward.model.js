import mongoose from 'mongoose';

const documentForwardSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true,
    },
    fromDepartmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
      index: true,
    },
    targetDepartmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
      index: true,
    },
    forwardedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    forwardedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    priority: {
      type: String,
      enum: ['routine', 'urgent', 'immediate'],
      default: 'routine',
    },
    accessControl: {
      type: String,
      enum: ['general', 'restricted', 'confidential', 'secret'],
      default: 'general',
    },
    remarks: {
      type: String,
      default: '',
      trim: true,
    },
    isDeletedForDept: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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

// High-speed compound indexes for instant retrieval of forwarded files
documentForwardSchema.index({ targetDepartmentId: 1, isDeletedForDept: 1, forwardedAt: -1 });
documentForwardSchema.index({ documentId: 1, targetDepartmentId: 1, isDeletedForDept: 1 });

export const DocumentForward = mongoose.model('DocumentForward', documentForwardSchema);
export default DocumentForward;
