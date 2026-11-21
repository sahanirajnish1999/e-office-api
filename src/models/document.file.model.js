import mongoose from 'mongoose';

const documentFileSchema = new mongoose.Schema(
  {
    // 1. Relational Links
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: [true, 'documentId is required'],
      index: true,
    },
    uploadUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'uploadUserId is required'],
      index: true,
    },

    // 2. Upload Timing & File Info
    uploadTime: {
      type: Date,
      default: Date.now,
      index: true,
    },
    originalName: {
      type: String,
      required: [true, 'originalName is required'],
      trim: true,
    },
    storedFilename: {
      type: String,
      required: [true, 'storedFilename is required'],
      trim: true,
    },
    filePath: {
      type: String,
      required: [true, 'filePath is required'],
      trim: true,
    },
    fileUrl: {
      type: String,
      required: [true, 'fileUrl is required'],
      trim: true,
    },
    mimeType: {
      type: String,
      default: '',
    },
    fileSize: {
      type: Number,
      default: 0,
    },
    pageNumber: {
      type: Number,
      default: 1,
      min: [1, 'pageNumber must be at least 1'],
    },
    fileSummary: {
      type: String,
      default: '',
      trim: true,
    },

    // 3. Approval Workflow
    status: {
      type: String,
      enum: ['pending', 'approve', 'reject'],
      default: 'pending',
      index: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// Virtual alias: uploadUserId -> uploadedBy
documentFileSchema.virtual('uploadedBy', {
  ref: 'User',
  localField: 'uploadUserId',
  foreignField: '_id',
  justOne: true,
});

documentFileSchema.index({ documentId: 1, status: 1 });
documentFileSchema.index({ documentId: 1, pageNumber: 1 });

export const DocumentFile = mongoose.model('DocumentFile', documentFileSchema);
export default DocumentFile;
