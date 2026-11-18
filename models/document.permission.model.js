import mongoose from 'mongoose';

const documentPermissionSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null,
    },
    // Granular File Access Permissions
    permissions: {
      canView: { type: Boolean, default: true },
      canRemark: { type: Boolean, default: true },
      canSuggestChange: { type: Boolean, default: true },
      canDownload: { type: Boolean, default: true },
      canHighlightDocuments: { type: Boolean, default: true },
      canUseStickyNotes: { type: Boolean, default: true },
      canAddOfficialNoting: { type: Boolean, default: false },
      canApproveNoting: { type: Boolean, default: false },
      canWithdrawFile: { type: Boolean, default: false },
      canDeletePartial: { type: Boolean, default: false },
    },
    grantedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    grantedAt: {
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

// Compound Unique Index: Prevents duplicate grants and enables O(1) instant lookup
documentPermissionSchema.index({ documentId: 1, userId: 1 }, { unique: true });

export const DocumentPermission = mongoose.model('DocumentPermission', documentPermissionSchema);
export default DocumentPermission;
