import mongoose from 'mongoose';

const virtualStickyNoteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      index: true,
    },
    userName: {
      type: String,
      default: '',
      trim: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: [true, 'documentId is required'],
      index: true,
    },
    detailSummary: {
      type: String,
      required: [true, 'detail summary is required'],
      trim: true,
    },
    stickyColor: {
      type: String,
      default: 'yellow',
      trim: true,
    },
    isPinned: {
      type: Boolean,
      default: false,
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
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

// Compound index for user notes on a document, sorted by pinned first, then latest date
virtualStickyNoteSchema.index({ userId: 1, documentId: 1, isPinned: -1, createdAt: -1 });

export const VirtualStickyNote = mongoose.model('VirtualStickyNote', virtualStickyNoteSchema);
export default VirtualStickyNote;
