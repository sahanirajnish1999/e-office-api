import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    // 1. Core Identification & Metadata
    fileNumber: {
      type: String,
      required: [true, 'File number is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Document title is required'],
      trim: true,
    },
    subject: {
      type: String,
      required: [true, 'Subject/purpose of the file is required'],
      trim: true,
    },
    priority: {
      type: String,
      enum: ['routine', 'urgent', 'immediate'],
      default: 'routine',
      index: true,
    },
    accessControl: {
      type: String,
      enum: ['general', 'restricted', 'confidential', 'secret'],
      default: 'general',
      index: true,
    },
    registrationDate: {
      type: Date,
      required: [true, 'Registration date must be manually chosen'],
      index: true,
    },
    highlights: [
      {
        type: String,
        trim: true,
      },
    ],

    // 2. Physical File Information (from Multer - Optional)
    originalName: { type: String, default: '' },
    storedFilename: { type: String, default: '' },
    filePath: { type: String, default: '' },
    fileUrl: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
    pageNumber: { type: Number, default: 1 },

    // 3. Header, Letterhead & Logo Customization
    logoFileName: {
      type: String,
      default: '',
      trim: true,
    },
    logoUrl: {
      type: String,
      default: '',
      trim: true,
    },
    logoOriginalName: {
      type: String,
      default: '',
      trim: true,
    },
    topHeadline: {
      type: String,
      default: '',
      trim: true,
    },
    topSubHeadline: {
      type: String,
      default: '',
      trim: true,
    },
    topOtherDetails: {
      type: String,
      default: '',
      trim: true,
    },
    footerDetails: {
      type: String,
      default: '',
      trim: true,
    },

    // 4. Primary Department Ownership
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
      index: true,
    },

    // 4. Official Document Notings
    notings: [
      {
        text: { type: String, required: true, trim: true },
        author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        authorName: { type: String, required: true },
        isApproved: { type: Boolean, default: false },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        approvedByName: String,
        approvedAt: Date,
        createdAt: { type: Date, default: Date.now },
      },
    ],

    // 7. Ownership, Deletion & Visibility Controls
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'withdrawn', 'archived'],
      default: 'active',
    },

    // Origin Department Deletion (Hidden for primary department, visible to Super Admin)
    isDeletedForOriginDept: { type: Boolean, default: false },
    originDeptDeletedAt: Date,
    originDeptDeletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
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

// Virtual aliases for compatibility and convenience
documentSchema.virtual('fileTitle').get(function () {
  return this.title;
});
documentSchema.virtual('fileSubject').get(function () {
  return this.subject;
});
documentSchema.virtual('filePriority').get(function () {
  return this.priority;
});
documentSchema.virtual('fileDate').get(function () {
  return this.registrationDate;
});
documentSchema.virtual('targetAudience').get(function () {
  return this.accessControl;
});

// Indexes for fast searching and multi-attribute filtering
documentSchema.index({ fileNumber: 'text', title: 'text', subject: 'text' });
documentSchema.index({ departmentId: 1, priority: 1, accessControl: 1, registrationDate: -1 });

export const Document = mongoose.model('Document', documentSchema);
export default Document;
