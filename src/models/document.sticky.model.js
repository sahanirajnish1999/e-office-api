import mongoose from 'mongoose';

const documentStickySchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: [true, 'documentId is required'],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    authorName: {
      type: String,
      required: true,
      trim: true,
    },
    pageNumber: {
      type: Number,
      default: 1,
      min: [1, 'pageNumber must be at least 1'],
    },
    color: {
      type: String,
      enum: ['yellow', 'blue', 'green', 'pink', 'orange', 'purple'],
      default: 'yellow',
    },
    note: {
      type: String,
      required: [true, 'Sticky note text is required'],
      trim: true,
    },

    // Approval tracking
    status: {
      type: String,
      enum: ['pending', 'approve', 'reject'],
      default: 'pending',
      index: true,
    },
    isApproved: {
      type: Boolean,
      default: false,
      index: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedByName: {
      type: String,
      default: '',
      trim: true,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    approvalIpAddress: {
      type: String,
      default: '',
      trim: true,
    },
    rejectionReason: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

documentStickySchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const DocumentSticky = mongoose.model('DocumentSticky', documentStickySchema);
export default DocumentSticky;
